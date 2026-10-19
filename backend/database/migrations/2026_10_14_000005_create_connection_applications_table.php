<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('connection_applications', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->index();
            $table->string('phone', 32);
            $table->text('address');
            $table->string('district', 100)->index();
            $table->string('area', 100)->index();
            $table->foreignId('package_id')->nullable()->constrained()->nullOnDelete();
            $table->string('document_path')->nullable();
            $table->string('status', 20)->default('pending')->index();
            $table->ipAddress('ip_address')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('connection_applications');
    }
};
