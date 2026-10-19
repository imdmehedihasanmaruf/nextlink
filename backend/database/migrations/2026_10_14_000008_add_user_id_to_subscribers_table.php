<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('subscribers', 'user_id')) {
            Schema::table('subscribers', function (Blueprint $table) {
                $table->foreignId('user_id')->nullable()->unique()->constrained()->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('subscribers', 'user_id')) {
            Schema::table('subscribers', function (Blueprint $table) {
                $table->dropConstrainedForeignId('user_id');
            });
        }
    }
};