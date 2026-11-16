<?php

namespace App\Services;

use Exception;
use InvalidArgumentException;

class JwtService
{
    protected string $secret;
    protected int $ttl;

    public function __construct(?string $secret = null, ?int $ttl = null)
    {
        $this->secret = $secret ?? config('jwt.secret', env('JWT_SECRET', 'nextlink-dev-secret-change-me'));
        $this->ttl = $ttl ?? (int) config('jwt.ttl', env('JWT_TTL', 604800));
    }

    /**
     * Base64Url encode a string.
     */
    public static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * Base64Url decode a string.
     */
    public static function base64UrlDecode(string $data): string
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $padLen = 4 - $remainder;
            $data .= str_repeat('=', $padLen);
        }
        return (string) base64_decode(strtr($data, '-_', '+/'));
    }

    /**
     * Sign a JWT token with HS256.
     */
    public function sign(array $payload, ?int $expiresIn = null): string
    {
        $header = [
            'typ' => 'JWT',
            'alg' => 'HS256',
        ];

        $now = time();
        $ttl = $expiresIn ?? $this->ttl;

        if (!isset($payload['iat'])) {
            $payload['iat'] = $now;
        }
        if (!isset($payload['exp']) && $ttl > 0) {
            $payload['exp'] = $now + $ttl;
        }

        $headerEncoded = self::base64UrlEncode(json_encode($header, JSON_UNESCAPED_SLASHES));
        $payloadEncoded = self::base64UrlEncode(json_encode($payload, JSON_UNESCAPED_SLASHES));

        $signature = hash_hmac('sha256', "$headerEncoded.$payloadEncoded", $this->secret, true);
        $signatureEncoded = self::base64UrlEncode($signature);

        return "$headerEncoded.$payloadEncoded.$signatureEncoded";
    }

    /**
     * Verify and decode a JWT token.
     *
     * @throws Exception if token is invalid, expired, or tampered.
     */
    public function verify(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidArgumentException('Malformed JWT: Invalid part count');
        }

        [$headerB64, $payloadB64, $sigB64] = $parts;

        // Decode and validate header
        $headerJson = self::base64UrlDecode($headerB64);
        $header = json_decode($headerJson, true);
        if (!is_array($header)) {
            throw new InvalidArgumentException('Malformed JWT: Invalid header encoding');
        }

        if (!isset($header['alg']) || $header['alg'] !== 'HS256') {
            throw new InvalidArgumentException('Unsupported JWT algorithm. Only HS256 is supported.');
        }

        // Verify signature with constant-time comparison
        $expectedSig = hash_hmac('sha256', "$headerB64.$payloadB64", $this->secret, true);
        $actualSig = self::base64UrlDecode($sigB64);

        if (!hash_equals($expectedSig, $actualSig)) {
            throw new InvalidArgumentException('Invalid JWT signature');
        }

        // Decode payload
        $payloadJson = self::base64UrlDecode($payloadB64);
        $payload = json_decode($payloadJson, true);
        if (!is_array($payload)) {
            throw new InvalidArgumentException('Malformed JWT: Invalid payload encoding');
        }

        $now = time();

        // Check expiration
        if (isset($payload['exp']) && $payload['exp'] < $now) {
            throw new InvalidArgumentException('JWT token has expired');
        }

        // Check not before (nbf)
        if (isset($payload['nbf']) && $payload['nbf'] > $now) {
            throw new InvalidArgumentException('JWT token is not active yet (nbf)');
        }

        return $payload;
    }

    /**
     * Safe verification: returns decoded payload array or null on any error.
     */
    public function tryVerify(?string $token): ?array
    {
        if (empty($token)) {
            return null;
        }

        try {
            return $this->verify($token);
        } catch (\Throwable $e) {
            return null;
        }
    }
}
