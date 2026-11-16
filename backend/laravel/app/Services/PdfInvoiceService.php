<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Package;
use App\Models\Subscriber;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

class PdfInvoiceService
{
    protected string $storageDir;

    public function __construct()
    {
        $this->storageDir = storage_path('app/invoices');
        if (!File::exists($this->storageDir)) {
            File::makeDirectory($this->storageDir, 0755, true);
        }
    }

    /**
     * Generate or return cached PDF for an invoice
     */
    public function generateInvoicePdf(Invoice $invoice): string
    {
        $raw = $invoice->raw_data ?? [];
        $subscriber = $invoice->subscriber ?? Subscriber::find($invoice->subscriber_id);
        $subscriberRaw = $subscriber ? ($subscriber->raw_data ?? []) : [];
        $packageId = $subscriber->package_id ?? ($raw['packageId'] ?? null);
        $package = $packageId ? Package::find($packageId) : null;

        $isCancel = strtolower((string) ($invoice->invoice_type ?? $raw['invoiceType'] ?? '')) === 'cancel'
            || str_contains((string) $invoice->id, 'CANCEL');

        $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '_', (string) $invoice->id);

        $subscriberName = (string) ($subscriber->name ?? $subscriberRaw['name'] ?? $raw['subscriberName'] ?? '');
        $subscriberAddress = (string) ($subscriber->address ?? $subscriberRaw['address'] ?? '');
        $subscriberPhone = (string) ($subscriber->phone ?? $subscriberRaw['phone'] ?? $raw['subscriberPhone'] ?? '');
        $packageName = (string) ($package->name ?? $raw['packageName'] ?? '');
        $packageSpeed = (string) ($package->speed ?? $raw['packageSpeed'] ?? '');

        $stampPayload = [
            'status' => (string) $invoice->status,
            'amount' => (string) $invoice->amount,
            'installation_fee' => (string) ($invoice->installation_fee ?? 0),
            'tax_fee' => (string) ($invoice->tax_fee ?? 0),
            'late_fee' => (string) ($invoice->late_fee ?? 0),
            'carried_over_amount' => (string) ($invoice->carried_over_amount ?? 0),
            'due_date' => (string) $invoice->due_date,
            'paidAt' => (string) ($raw['paidAt'] ?? ''),
            'invoice_type' => (string) ($invoice->invoice_type ?? $raw['invoiceType'] ?? ''),
            'subscriber_name' => $subscriberName,
            'subscriber_address' => $subscriberAddress,
            'subscriber_phone' => $subscriberPhone,
            'package_name' => $packageName,
            'package_speed' => $packageSpeed,
            'lines' => $raw['lines'] ?? [],
            'purchaseSession' => $raw['purchaseSession'] ?? [],
            'cancelSession' => $raw['cancelSession'] ?? [],
        ];
        $stamp = hash('sha256', json_encode($stampPayload));

        $filePath = "{$this->storageDir}/{$safeId}.pdf";
        $stampPath = "{$filePath}.stamp";

        $cachedStamp = File::exists($stampPath) ? File::get($stampPath) : null;

        if (File::exists($filePath) && $cachedStamp === $stamp) {
            return File::get($filePath);
        }

        $brand = [
            'name' => 'NextLink Global',
            'tagline' => 'NextLink Global ISP — Tier-1 Optical Infrastructure',
            'address' => 'Head Office, Optical IXP Center, Dhaka, Bangladesh',
            'email' => 'billing@nextlink.global',
            'phone' => '+880 1700 000000',
        ];

        $issuedAt = $invoice->created_at ? Carbon::parse($invoice->created_at)->toDateString() : Carbon::now('UTC')->toDateString();
        $dueDate = $invoice->due_date ?? ($raw['dueDate'] ?? 'Immediate');

        $lines = $raw['lines'] ?? null;

        $viewData = [
            'invoice' => $invoice->toArray(),
            'raw' => $raw,
            'subscriber' => $subscriber ? $subscriber->toArray() : [],
            'subscriberRaw' => $subscriberRaw,
            'package' => $package ? $package->toArray() : [],
            'brand' => $brand,
            'isCancel' => $isCancel,
            'issuedAt' => $issuedAt,
            'dueDate' => $dueDate,
            'lines' => $lines,
            'currency' => $raw['currency'] ?? 'USD',
        ];

        $pdf = Pdf::loadView('invoices.pdf', $viewData);
        $pdf->setPaper('a4', 'portrait');
        $output = $pdf->output();

        // Atomic write with path safety
        $tmpPdf = tempnam($this->storageDir, 'pdf_');
        $tmpStamp = tempnam($this->storageDir, 'stp_');
        File::put($tmpPdf, $output);
        File::put($tmpStamp, $stamp);
        @rename($tmpPdf, $filePath);
        @rename($tmpStamp, $stampPath);

        return $output;
    }

    /**
     * Get path to stored invoice PDF
     */
    public function getInvoicePdfPath(string $invoiceId): string
    {
        $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $invoiceId);
        return "{$this->storageDir}/{$safeId}.pdf";
    }
}
