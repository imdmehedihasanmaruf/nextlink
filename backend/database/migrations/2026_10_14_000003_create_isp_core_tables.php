<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('packages', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120)->unique();
            $table->text('description')->nullable();
            $table->unsignedInteger('download_mbps');
            $table->unsignedInteger('upload_mbps');
            $table->unsignedInteger('bdix_mbps')->nullable();
            $table->decimal('price_monthly', 10, 2);
            $table->decimal('installation_fee', 10, 2)->default(0);
            $table->json('features');
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });


        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subscriber_id')->constrained()->cascadeOnDelete();
            $table->string('invoice_number', 40)->unique();
            $table->decimal('amount', 10, 2);
            $table->date('billing_period_start');
            $table->date('billing_period_end');
            $table->date('due_date');
            $table->timestamp('paid_at')->nullable();
            $table->string('status', 20)->default('unpaid')->index();
            $table->timestamps();
            $table->unique(['subscriber_id', 'billing_period_start', 'billing_period_end']);
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignId('subscriber_id')->constrained()->cascadeOnDelete();
            $table->string('method', 32);
            $table->string('transaction_reference', 120)->nullable()->unique();
            $table->decimal('amount', 10, 2);
            $table->string('status', 20)->default('pending')->index();
            $table->timestamp('verified_at')->nullable();
            $table->foreignId('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('support_tickets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subscriber_id')->constrained()->cascadeOnDelete();
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->string('subject', 180);
            $table->text('description');
            $table->string('priority', 16)->default('medium');
            $table->string('status', 20)->default('open')->index();
            $table->timestamp('sla_due_at')->nullable()->index();
            $table->timestamps();
        });

        Schema::create('ticket_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ticket_id')->constrained('support_tickets')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('body');
            $table->timestamps();
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 120);
            $table->string('record_type', 120)->nullable();
            $table->string('record_id', 64)->nullable();
            $table->json('metadata')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamps();
            $table->index(['record_type', 'record_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('ticket_messages');
        Schema::dropIfExists('support_tickets');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('invoices');
        
        Schema::dropIfExists('packages');
    }
};
