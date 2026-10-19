<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscribers', function (Blueprint $table) {
            if (! Schema::hasColumn('subscribers', 'subscriber_number')) {
                $table->string('subscriber_number', 32)->nullable()->unique();
            }
            if (! Schema::hasColumn('subscribers', 'phone')) {
                $table->string('phone', 32)->nullable();
            }
            if (! Schema::hasColumn('subscribers', 'address')) {
                $table->text('address')->nullable();
            }
            if (! Schema::hasColumn('subscribers', 'connection_type')) {
                $table->string('connection_type', 20)->default('pppoe');
            }
            if (! Schema::hasColumn('subscribers', 'ip_address')) {
                $table->string('ip_address', 45)->nullable();
            }
            if (! Schema::hasColumn('subscribers', 'status')) {
                $table->string('status', 20)->default('pending')->index();
            }
            if (! Schema::hasColumn('subscribers', 'package_id')) {
                $table->foreignId('package_id')->nullable()->constrained()->nullOnDelete();
            }
            if (! Schema::hasColumn('subscribers', 'user_id')) {
                $table->foreignId('user_id')->nullable()->unique()->constrained()->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        // Keep data-bearing subscriber columns on rollback; destructive rollback is unsafe.
    }
};