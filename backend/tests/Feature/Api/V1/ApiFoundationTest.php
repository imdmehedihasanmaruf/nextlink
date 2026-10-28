<?php

namespace Tests\Feature\Api\V1;

use App\Models\Subscriber;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ApiFoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_endpoint_returns_ok(): void
    {
        $this->get('/up')->assertOk()->assertSeeText('Application up');
    }

    public function test_cors_preflight_allows_the_production_frontend(): void
    {
        $this->withHeaders([
            'Origin' => 'https://nextlink-isp.vercel.app',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type,accept',
        ])->options('/api/v1/auth/login')
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'https://nextlink-isp.vercel.app');
    }

    public function test_invalid_login_credentials_are_rejected(): void
    {
        User::create(['name' => 'Admin', 'email' => 'admin@example.test', 'password' => Hash::make('correct-horse-battery'), 'role' => 'super_admin']);

        $this->postJson('/api/v1/auth/login', ['email' => 'admin@example.test', 'password' => 'incorrect-password'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    }

    public function test_login_returns_a_sanctum_token_and_me_requires_authentication(): void
    {
        User::create(['name' => 'Admin', 'email' => 'admin@example.test', 'password' => Hash::make('correct-horse-battery'), 'role' => 'super_admin']);
        $this->withToken('invalid-token')->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['email' => 'admin@example.test', 'password' => 'correct-horse-battery'])->assertOk()->assertJsonPath('success', true)->assertJsonStructure(['data' => ['user', 'token']]);
    }

    public function test_admin_dashboard_returns_metrics_with_subscriber_profile_schema(): void
    {
        $admin = User::factory()->create(['role' => 'super_admin']);

        $this->actingAs($admin, 'sanctum')
            ->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data' => ['total_subscribers', 'active_connections', 'suspended_connections', 'pending_connections', 'open_tickets', 'unpaid_invoice_total', 'monthly_recurring_revenue']]);
    }

    public function test_authenticated_user_can_update_profile_name(): void
    {
        $admin = User::factory()->create(['role' => 'super_admin']);

        $this->actingAs($admin, 'sanctum')
            ->postJson('/api/v1/auth/profile', ['name' => 'Updated Administrator'])
            ->assertOk()
            ->assertJsonPath('data.user.name', 'Updated Administrator');
    }

    public function test_subscriber_cannot_access_another_subscribers_record(): void
    {
        $one = User::create(['name' => 'One', 'email' => 'one@example.test', 'password' => Hash::make('password')]);
        $two = User::create(['name' => 'Two', 'email' => 'two@example.test', 'password' => Hash::make('password')]);
        $subscriber = Subscriber::create(['user_id' => $two->id, 'subscriber_number' => 'SUB-0002', 'status' => 'active']);
        $this->actingAs($one)->getJson('/api/v1/subscribers/'.$subscriber->id)->assertForbidden();
    }

    public function test_package_list_and_create_obey_role_permissions(): void
    {
        $this->getJson('/api/v1/packages')->assertOk()->assertJsonPath('data', []);
        $user = User::create(['name' => 'Subscriber', 'email' => 'subscriber@example.test', 'password' => Hash::make('password')]);
        $this->actingAs($user)->postJson('/api/v1/packages', [])->assertForbidden();
    }

    public function test_admin_package_list_includes_subscriber_counts_and_decoded_features(): void
    {
        $admin = User::factory()->create(['role' => 'super_admin']);
        $customer = User::factory()->create(['role' => 'subscriber']);
        $packageId = DB::table('packages')->insertGetId(['name' => 'Fibre Plus', 'description' => 'Fast access', 'download_mbps' => 80, 'upload_mbps' => 40, 'price_monthly' => 1200, 'installation_fee' => 500, 'features' => '["Support","Unlimited"]', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        Subscriber::create(['user_id' => $customer->id, 'subscriber_number' => 'SUB-PKG-01', 'package_id' => $packageId, 'status' => 'active']);

        $this->actingAs($admin, 'sanctum')
            ->getJson('/api/v1/packages?search=Fibre&is_active=1')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Fibre Plus')
            ->assertJsonPath('data.0.features.0', 'Support')
            ->assertJsonPath('data.0.subscriber_count', 1);
    }

    public function test_invoice_generation_is_idempotent_and_payment_verification_updates_invoice(): void
    {
        $staff = User::create(['name' => 'Billing', 'email' => 'billing@example.test', 'password' => Hash::make('password'), 'role' => 'accounts_billing']);
        $customer = User::create(['name' => 'Customer', 'email' => 'customer@example.test', 'password' => Hash::make('password')]);
        $package = DB::table('packages')->insertGetId(['name' => 'Test', 'download_mbps' => 50, 'upload_mbps' => 20, 'price_monthly' => 100, 'installation_fee' => 0, 'features' => '[]', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $subscriber = Subscriber::create(['user_id' => $customer->id, 'subscriber_number' => 'SUB-0003', 'package_id' => $package, 'status' => 'active']);
        $payload = ['subscriber_id' => $subscriber->id, 'billing_period_start' => '2026-10-01', 'billing_period_end' => '2026-10-31', 'due_date' => '2026-11-05'];
        $response = $this->actingAs($staff)->postJson('/api/v1/invoices/generate', $payload);
        $this->assertSame('Invoice generated.', $response->json('message'));
        $response->assertCreated();
        $this->postJson('/api/v1/invoices/generate', $payload)->assertOk();
        $this->assertDatabaseCount('invoices', 1);
        $invoice = DB::table('invoices')->first();
        $payment = DB::table('payments')->insertGetId(['invoice_id' => $invoice->id, 'subscriber_id' => $subscriber->id, 'method' => 'cash', 'amount' => 100, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
        $this->postJson('/api/v1/payments/'.$payment.'/verify', ['status' => 'verified'])->assertOk();
        $this->assertDatabaseHas('invoices', ['id' => $invoice->id, 'status' => 'paid']);
    }

    public function test_subscriber_cannot_create_a_ticket_for_another_subscriber(): void
    {
        $one = User::create(['name' => 'One', 'email' => 'one@example.test', 'password' => Hash::make('password')]);
        $two = User::create(['name' => 'Two', 'email' => 'two@example.test', 'password' => Hash::make('password')]);
        $subscriber = Subscriber::create(['user_id' => $two->id, 'subscriber_number' => 'SUB-0005', 'status' => 'active']);
        $this->actingAs($one)->postJson('/api/v1/tickets', ['subscriber_id' => $subscriber->id, 'subject' => 'Help', 'description' => 'Please help'])->assertForbidden();
    }

    public function test_subscriber_cannot_read_another_subscribers_invoices(): void
    {
        $one = User::create(['name' => 'One', 'email' => 'one@example.test', 'password' => Hash::make('password')]);
        $two = User::create(['name' => 'Two', 'email' => 'two@example.test', 'password' => Hash::make('password')]);
        $subscriber = Subscriber::create(['user_id' => $two->id, 'subscriber_number' => 'SUB-0004', 'status' => 'active']);
        DB::table('invoices')->insert(['subscriber_id' => $subscriber->id, 'invoice_number' => 'INV-0004', 'amount' => 50, 'billing_period_start' => '2026-09-01', 'billing_period_end' => '2026-09-30', 'due_date' => '2026-10-05', 'status' => 'unpaid', 'created_at' => now(), 'updated_at' => now()]);
        $this->actingAs($one)->getJson('/api/v1/invoices')->assertOk()->assertJsonPath('data', []);
    }
}
