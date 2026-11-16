<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

class PostgresTextArray implements CastsAttributes
{
    /**
     * Cast the given PostgreSQL TEXT[] literal value to a PHP array.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<int, string|null>
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): array
    {
        if ($value === null) {
            return [];
        }

        if (is_array($value)) {
            return $value;
        }

        $str = trim((string) $value);
        if ($str === '' || $str === '{}') {
            return [];
        }

        if (str_starts_with($str, '[')) {
            $decoded = json_decode($str, true);
            return is_array($decoded) ? array_values($decoded) : [];
        }

        if (str_starts_with($str, '{') && str_ends_with($str, '}')) {
            $inner = substr($str, 1, -1);
            if ($inner === '') {
                return [];
            }

            return self::parsePgArrayInner($inner);
        }

        return [$str];
    }

    /**
     * Prepare the given value for storage in a PostgreSQL TEXT[] column.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        if ($value === null || $value === []) {
            return '{}';
        }

        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed === '' || $trimmed === '{}') {
                return '{}';
            }
            if (str_starts_with($trimmed, '[')) {
                $decoded = json_decode($trimmed, true);
                $value = is_array($decoded) ? $decoded : [$trimmed];
            } elseif (str_starts_with($trimmed, '{') && str_ends_with($trimmed, '}')) {
                $inner = substr($trimmed, 1, -1);
                $value = $inner === '' ? [] : self::parsePgArrayInner($inner);
            } else {
                $value = [$trimmed];
            }
        }

        if (!is_array($value)) {
            $value = [$value];
        }

        if (count($value) === 0) {
            return '{}';
        }

        $encodedElements = [];
        foreach ($value as $item) {
            if ($item === null) {
                $encodedElements[] = 'NULL';
                continue;
            }
            $strItem = (string) $item;
            $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $strItem);
            $encodedElements[] = '"' . $escaped . '"';
        }

        return '{' . implode(',', $encodedElements) . '}';
    }

    /**
     * Parse the interior of a 1D PostgreSQL TEXT[] literal `{...}`.
     *
     * @return array<int, string|null>
     */
    public static function parsePgArrayInner(string $inner): array
    {
        $result = [];
        $len = strlen($inner);
        $i = 0;

        while ($i < $len) {
            // Skip leading whitespace before element
            while ($i < $len && ($inner[$i] === ' ' || $inner[$i] === "\t")) {
                $i++;
            }

            if ($i >= $len) {
                break;
            }

            if ($inner[$i] === '"') {
                // Quoted element
                $i++; // skip opening quote
                $elem = '';
                while ($i < $len) {
                    $ch = $inner[$i];
                    if ($ch === '\\' && $i + 1 < $len) {
                        $elem .= $inner[$i + 1];
                        $i += 2;
                        continue;
                    }
                    if ($ch === '"') {
                        $i++; // skip closing quote
                        break;
                    }
                    $elem .= $ch;
                    $i++;
                }
                $result[] = $elem;

                // Advance to next comma or end
                while ($i < $len && $inner[$i] !== ',') {
                    $i++;
                }
                if ($i < $len && $inner[$i] === ',') {
                    $i++;
                }
            } else {
                // Unquoted element
                $start = $i;
                while ($i < $len && $inner[$i] !== ',') {
                    $i++;
                }
                $raw = trim(substr($inner, $start, $i - $start));
                if (strcasecmp($raw, 'NULL') === 0) {
                    $result[] = null;
                } else {
                    $result[] = $raw;
                }
                if ($i < $len && $inner[$i] === ',') {
                    $i++;
                }
            }
        }

        return $result;
    }
}
