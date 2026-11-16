<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice {{ $invoice['id'] ?? '' }}</title>
    <style>
        body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 0;
            font-size: 12px;
            line-height: 1.4;
        }
        .header {
            background-color: {{ !empty($isCancel) ? '#7f1d1d' : '#0f2f6b' }};
            color: #ffffff;
            padding: 24px 30px;
        }
        .header-table {
            width: 100%;
            border-collapse: collapse;
        }
        .brand-name {
            font-size: 20px;
            font-weight: bold;
            margin: 0 0 4px 0;
        }
        .brand-tagline {
            font-size: 9px;
            color: #cbd5e1;
            margin: 0 0 4px 0;
        }
        .brand-contact {
            font-size: 8px;
            color: #94a3b8;
        }
        .invoice-title {
            font-size: 14px;
            font-weight: bold;
            text-align: right;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .invoice-meta {
            font-size: 9px;
            text-align: right;
            color: #e2e8f0;
            margin-top: 4px;
        }
        .content {
            padding: 24px 30px;
        }
        .details-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
        }
        .details-col {
            width: 50%;
            vertical-align: top;
        }
        .section-title {
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            color: #64748b;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }
        .sub-name {
            font-size: 13px;
            font-weight: bold;
            color: #0f172a;
        }
        .sub-meta {
            font-size: 11px;
            color: #475569;
            margin-top: 2px;
        }
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        .items-table th {
            background-color: #f1f5f9;
            color: #475569;
            font-size: 9px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 8px 12px;
            border-bottom: 1px solid #cbd5e1;
            text-align: left;
        }
        .items-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #e2e8f0;
            font-size: 11px;
        }
        .items-table .text-right {
            text-align: right;
        }
        .summary-table {
            width: 45%;
            margin-left: auto;
            border-collapse: collapse;
            margin-bottom: 30px;
        }
        .summary-table td {
            padding: 6px 12px;
            font-size: 11px;
        }
        .summary-table .label {
            color: #64748b;
        }
        .summary-table .amount {
            text-align: right;
            font-weight: 500;
        }
        .summary-table .total-row td {
            border-top: 2px solid #0f2f6b;
            font-size: 13px;
            font-weight: bold;
            color: #0f172a;
            padding-top: 8px;
        }
        .badge {
            display: inline-block;
            padding: 4px 10px;
            font-size: 10px;
            font-weight: bold;
            border-radius: 4px;
            text-transform: uppercase;
        }
        .badge-paid {
            background-color: #dcfce7;
            color: #15803d;
            border: 1px solid #bbf7d0;
        }
        .badge-unpaid {
            background-color: #fee2e2;
            color: #b91c1c;
            border: 1px solid #fecaca;
        }
        .footer {
            margin-top: 40px;
            padding-top: 15px;
            border-top: 1px solid #e2e8f0;
            font-size: 9px;
            color: #94a3b8;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="header">
        <table class="header-table">
            <tr>
                <td style="vertical-align: top;">
                    <div class="brand-name">{{ $brand['name'] ?? 'NextLink Global' }}</div>
                    <div class="brand-tagline">{{ $brand['tagline'] ?? 'NextLink Global ISP — Tier-1 Optical Infrastructure' }}</div>
                    <div class="brand-contact">
                        {{ $brand['address'] ?? 'Head Office, Optical IXP Center, Dhaka, Bangladesh' }}<br>
                        {{ $brand['email'] ?? 'billing@nextlink.global' }} | {{ $brand['phone'] ?? '+880 1700 000000' }}
                    </div>
                </td>
                <td style="vertical-align: top;">
                    <div class="invoice-title">{{ !empty($isCancel) ? 'UNSUBSCRIBER CANCEL INVOICE' : 'OFFICIAL TAX INVOICE' }}</div>
                    <div class="invoice-meta">
                        <strong>Invoice #:</strong> {{ $invoice['id'] ?? '' }}<br>
                        <strong>{{ !empty($isCancel) ? 'Cancelled' : 'Issued' }}:</strong> {{ $issuedAt ?? now()->toDateString() }}<br>
                        <strong>{{ !empty($isCancel) ? 'Effective' : 'Due Date' }}:</strong> {{ $dueDate ?? $invoice['due_date'] ?? 'Immediate' }}<br>
                        <div style="margin-top: 6px;">
                            @if(strtolower($invoice['status'] ?? '') === 'paid')
                                <span class="badge badge-paid">PAID</span>
                            @else
                                <span class="badge badge-unpaid">{{ strtoupper($invoice['status'] ?? 'UNPAID') }}</span>
                            @endif
                        </div>
                    </div>
                </td>
            </tr>
        </table>
    </div>

    <div class="content">
        <table class="details-table">
            <tr>
                <td class="details-col">
                    <div class="section-title">Billed To</div>
                    <div class="sub-name">{{ $subscriber['name'] ?? $raw['subscriberName'] ?? 'Subscriber' }}</div>
                    <div class="sub-meta">
                        ID: {{ $subscriber['id'] ?? $invoice['subscriber_id'] ?? '' }}<br>
                        Phone: {{ $subscriber['phone'] ?? $raw['subscriberPhone'] ?? 'N/A' }}<br>
                        Email: {{ $subscriber['email'] ?? $raw['subscriberEmail'] ?? 'N/A' }}<br>
                        Address: {{ $subscriberRaw['address'] ?? $raw['address'] ?? 'Dhaka, Bangladesh' }}
                    </div>
                </td>
                <td class="details-col" style="text-align: right;">
                    <div class="section-title">Subscription Plan</div>
                    <div class="sub-name">{{ $raw['packageName'] ?? $package['name'] ?? 'Fiber Internet' }}</div>
                    <div class="sub-meta">
                        Billing Period: {{ $raw['period'] ?? now()->format('Y-m') }}<br>
                        Currency: {{ $currency ?? 'USD' }}<br>
                        @if(!empty($raw['paidVia']))
                            Paid Via: {{ strtoupper($raw['paidVia']) }}<br>
                        @endif
                        @if(!empty($raw['transactionId']))
                            Transaction ID: {{ $raw['transactionId'] }}<br>
                        @endif
                    </div>
                </td>
            </tr>
        </table>

        <table class="items-table">
            <thead>
                <tr>
                    <th style="width: 50%;">Description</th>
                    <th style="width: 25%;">Type</th>
                    <th class="text-right" style="width: 25%;">Amount</th>
                </tr>
            </thead>
            <tbody>
                @if(!empty($lines) && is_array($lines))
                    @foreach($lines as $line)
                        <tr>
                            <td>
                                <strong>{{ $line['label'] ?? $line['description'] ?? 'Line Item' }}</strong>
                            </td>
                            <td>{{ ucfirst(str_replace('_', ' ', $line['type'] ?? $line['code'] ?? 'item')) }}</td>
                            <td class="text-right">${{ number_format((float) ($line['amount'] ?? 0), 2) }}</td>
                        </tr>
                    @endforeach
                @else
                    <tr>
                        <td>
                            <strong>{{ $raw['packageName'] ?? $package['name'] ?? 'Monthly Subscription' }}</strong>
                        </td>
                        <td>Subscription</td>
                        <td class="text-right">${{ number_format((float) ($invoice['amount'] ?? 0), 2) }}</td>
                    </tr>
                    @if(!empty($invoice['installation_fee']) && (float) $invoice['installation_fee'] > 0)
                        <tr>
                            <td>One-Time Installation Fee</td>
                            <td>Installation</td>
                            <td class="text-right">${{ number_format((float) $invoice['installation_fee'], 2) }}</td>
                        </tr>
                    @endif
                    @if(!empty($invoice['tax_fee']) && (float) $invoice['tax_fee'] > 0)
                        <tr>
                            <td>Tax & Regulatory Fee</td>
                            <td>Tax</td>
                            <td class="text-right">${{ number_format((float) $invoice['tax_fee'], 2) }}</td>
                        </tr>
                    @endif
                    @if(!empty($invoice['late_fee']) && (float) $invoice['late_fee'] > 0)
                        <tr>
                            <td>Late Fee</td>
                            <td>Late Fee</td>
                            <td class="text-right">${{ number_format((float) $invoice['late_fee'], 2) }}</td>
                        </tr>
                    @endif
                    @if(!empty($invoice['carried_over_amount']) && (float) $invoice['carried_over_amount'] > 0)
                        <tr>
                            <td>Carried-Over Balance</td>
                            <td>Carried Over</td>
                            <td class="text-right">${{ number_format((float) $invoice['carried_over_amount'], 2) }}</td>
                        </tr>
                    @endif
                @endif
            </tbody>
        </table>

        <table class="summary-table">
            @if(!empty($invoice['installation_fee']) && (float) $invoice['installation_fee'] > 0)
                <tr>
                    <td class="label">Installation Fee:</td>
                    <td class="amount">${{ number_format((float) $invoice['installation_fee'], 2) }}</td>
                </tr>
            @endif
            @if(!empty($invoice['tax_fee']) && (float) $invoice['tax_fee'] > 0)
                <tr>
                    <td class="label">Tax & Fees:</td>
                    <td class="amount">${{ number_format((float) $invoice['tax_fee'], 2) }}</td>
                </tr>
            @endif
            @if(!empty($invoice['late_fee']) && (float) $invoice['late_fee'] > 0)
                <tr>
                    <td class="label">Late Fee:</td>
                    <td class="amount">${{ number_format((float) $invoice['late_fee'], 2) }}</td>
                </tr>
            @endif
            @if(!empty($invoice['carried_over_amount']) && (float) $invoice['carried_over_amount'] > 0)
                <tr>
                    <td class="label">Carried Over:</td>
                    <td class="amount">${{ number_format((float) $invoice['carried_over_amount'], 2) }}</td>
                </tr>
            @endif
            <tr class="total-row">
                <td class="label">Total Amount:</td>
                <td class="amount">${{ number_format((float) ($invoice['amount'] ?? 0), 2) }}</td>
            </tr>
        </table>

        <div class="footer">
            Thank you for choosing NextLink Global! For queries, contact billing@nextlink.global or call +880 1700 000000.<br>
            This is a computer-generated tax invoice. No signature required.
        </div>
    </div>
</body>
</html>
