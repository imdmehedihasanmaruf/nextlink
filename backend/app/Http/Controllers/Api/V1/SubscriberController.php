<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\SubscriberRequest;
use App\Http\Resources\Api\V1\SubscriberResource;
use App\Models\Subscriber;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SubscriberController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Subscriber::class);
        $query = Subscriber::query()->with(['user', 'package']);
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($q) => $q->where('subscriber_number', 'like', "%{$search}%")
                ->orWhere('phone', 'like', "%{$search}%")
                ->orWhereHas('user', fn ($u) => $u->where('name', 'like', "%{$search}%")->orWhere('email', 'like', "%{$search}%")));
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        $subscribers = $query->orderBy('id')->paginate(min(max($request->integer('per_page', 20), 1), 100));
        return response()->json(['success' => true, 'message' => 'Subscribers retrieved successfully.', 'data' => SubscriberResource::collection($subscribers)->resolve(), 'meta' => ['current_page' => $subscribers->currentPage(), 'per_page' => $subscribers->perPage(), 'total' => $subscribers->total(), 'last_page' => $subscribers->lastPage()]]);
    }

    public function store(SubscriberRequest $request): JsonResponse
    {
        $this->authorize('create', Subscriber::class);
        $data = $request->validated();
        $subscriber = DB::transaction(function () use ($data) {
            $user = User::create(['name' => $data['name'], 'email' => $data['email'], 'password' => Str::random(48), 'role' => 'subscriber']);
            return $user->subscriber()->create(collect($data)->only(['phone', 'address', 'connection_type', 'ip_address', 'status', 'package_id'])->all() + ['subscriber_number' => 'SUB-'.Str::upper(Str::random(10))]);
        });
        return response()->json(['success' => true, 'message' => 'Subscriber created successfully.', 'data' => (new SubscriberResource($subscriber->load('user')))->resolve()], 201);
    }

    public function show(Request $request, Subscriber $subscriber): JsonResponse
    {
        $this->authorize('view', $subscriber);
        return response()->json(['success' => true, 'data' => (new SubscriberResource($subscriber->load('user')))->resolve()]);
    }

    public function update(SubscriberRequest $request, Subscriber $subscriber): JsonResponse
    {
        $this->authorize('update', $subscriber);
        $data = $request->validated();
        DB::transaction(function () use ($data, $subscriber) {
            $subscriber->update(collect($data)->only(['phone', 'address', 'connection_type', 'ip_address', 'status'])->all());
            if ($subscriber->user && $subscriber->user_id === request()->user()->id && request()->user()->role === 'subscriber') {
                $subscriber->user->update(collect($data)->only(['name'])->all());
            } elseif (request()->user()->role !== 'subscriber') {
                $subscriber->user?->update(collect($data)->only(['name', 'email'])->all());
            }
        });
        return response()->json(['success' => true, 'message' => 'Subscriber updated successfully.', 'data' => (new SubscriberResource($subscriber->fresh('user')))->resolve()]);
    }

    public function destroy(Subscriber $subscriber): JsonResponse
    {
        $this->authorize('delete', $subscriber);
        DB::transaction(fn () => $subscriber->user?->delete());
        return response()->json(['success' => true, 'message' => 'Subscriber deleted successfully.']);
    }
}
