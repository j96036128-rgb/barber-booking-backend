# Phase 7.1 — Frontend API Contract + UI Flow Definition

**Status: LOCKED**
**Date: 2024-12-24**

This document defines the frontend-facing API contract and UI flows for the barber shop booking application. All decisions marked as **LOCKED** are final and must not be changed without explicit approval.

---

## Table of Contents

1. [Frontend API Contract](#1-frontend-api-contract-locked)
2. [Error Contract](#2-error-contract-locked)
3. [Role-Based UI Flows](#3-role-based-ui-flows)
4. [UI State Rules](#4-ui-state-rules-locked)

---

## 1. Frontend API Contract (LOCKED)

### 1.1 Authentication

#### POST /auth/register

| Property | Value |
|----------|-------|
| Auth Required | No |
| Allowed Roles | N/A (public) |

**Request Body:**
```json
{
  "email": "string",
  "password": "string (min 8 chars)",
  "role": "CUSTOMER | BARBER | SHOP_OWNER"
}
```

**Success Response (201):**
```json
{
  "token": "string (JWT)",
  "user": {
    "id": "string (UUID)",
    "email": "string",
    "role": "string"
  }
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Show field-level errors |
| EMAIL_ALREADY_EXISTS | 409 | Show "Email already registered" |

**Frontend Notes:**
- Store JWT in secure storage (httpOnly cookie or secure localStorage)
- Redirect to role-appropriate dashboard on success

---

#### POST /auth/login

| Property | Value |
|----------|-------|
| Auth Required | No |
| Allowed Roles | N/A (public) |

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Success Response (200):**
```json
{
  "token": "string (JWT)",
  "user": {
    "id": "string (UUID)",
    "email": "string",
    "role": "string"
  }
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Show field-level errors |
| INVALID_CREDENTIALS | 401 | Show "Invalid email or password" |

**Frontend Notes:**
- Store JWT in secure storage
- Redirect to role-appropriate dashboard on success

---

### 1.2 Public Browsing

#### GET /shops

| Property | Value |
|----------|-------|
| Auth Required | No |
| Allowed Roles | N/A (public) |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string (UUID)",
    "name": "string",
    "address": "string",
    "phone": "string",
    "owner": { "id": "string", "email": "string" },
    "barbers": [
      {
        "id": "string (UUID)",
        "isActive": "boolean"
      }
    ],
    "services": [
      {
        "id": "string (UUID)",
        "name": "string",
        "durationMinutes": "number",
        "priceCents": "number"
      }
    ]
  }
]
```

**Possible Errors:** None expected

**Frontend Notes:**
- Cache results for performance
- Display shop cards with basic info
- Show service count and barber count per shop

---

#### GET /shops/:shopId/barbers

| Property | Value |
|----------|-------|
| Auth Required | No |
| Allowed Roles | N/A (public) |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string (UUID)",
    "isActive": "boolean",
    "user": {
      "id": "string",
      "email": "string"
    },
    "services": [
      {
        "id": "string",
        "name": "string",
        "durationMinutes": "number",
        "priceCents": "number"
      }
    ]
  }
]
```

**Possible Errors:** None expected

**Frontend Notes:**
- Filter out inactive barbers for display (isActive: false)
- Show barber's offered services

---

#### GET /shops/:shopId/services

| Property | Value |
|----------|-------|
| Auth Required | No |
| Allowed Roles | N/A (public) |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string (UUID)",
    "name": "string",
    "durationMinutes": "number",
    "priceCents": "number",
    "shopId": "string",
    "barberId": "string | null",
    "barber": { "id": "string" } | null
  }
]
```

**Possible Errors:** None expected

**Frontend Notes:**
- Display prices formatted as currency (priceCents / 100)
- Show duration in human-readable format

---

### 1.3 Availability

#### GET /barbers/:barberId/slots

| Property | Value |
|----------|-------|
| Auth Required | No |
| Allowed Roles | N/A (public) |

**Required Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| startDate | ISO 8601 string | Start of date range |
| endDate | ISO 8601 string | End of date range |
| serviceId | UUID string | Service being booked |

**Example:**
```
GET /barbers/abc-123/slots?startDate=2024-12-26&endDate=2024-12-28&serviceId=xyz-789
```

**Success Response (200):**
```json
[
  {
    "date": "2024-12-26T00:00:00.000Z",
    "slots": [
      {
        "startTime": "2024-12-26T09:00:00.000Z",
        "endTime": "2024-12-26T09:30:00.000Z"
      },
      {
        "startTime": "2024-12-26T09:15:00.000Z",
        "endTime": "2024-12-26T09:45:00.000Z"
      }
    ]
  }
]
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Show "Please select valid dates" |
| SERVICE_NOT_FOUND | 404 | Show "Service not available" |
| BARBER_NOT_FOUND | 404 | Show "Barber not found" |
| BARBER_NOT_ACTIVE | 400 | Show "Barber is not available" |
| INVALID_DATE_RANGE | 400 | Show "Invalid date range" |

**Frontend Notes:**
- Display slots grouped by date
- Slots are in 15-minute intervals
- endTime = startTime + service duration
- Grey out past slots
- Refresh on date range change

---

### 1.4 Appointments

#### POST /appointments

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | CUSTOMER, BARBER, SHOP_OWNER, ADMIN |

**Request Body:**
```json
{
  "barberId": "string (UUID)",
  "customerId": "string (UUID)",
  "serviceId": "string (UUID)",
  "startTime": "ISO 8601 string"
}
```

**Success Response (201):**
```json
{
  "id": "string (UUID)",
  "startTime": "ISO 8601",
  "endTime": "ISO 8601",
  "status": "BOOKED",
  "customer": { "id": "string", "email": "string" },
  "barber": {
    "id": "string",
    "user": { "email": "string" },
    "shop": { "name": "string" }
  },
  "service": {
    "name": "string",
    "durationMinutes": "number",
    "priceCents": "number"
  }
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Show field-level errors |
| BARBER_NOT_FOUND | 404 | Show "Barber not found" |
| SERVICE_NOT_FOUND | 404 | Show "Service not found" |
| CUSTOMER_NOT_FOUND | 404 | Show "Customer not found" |
| BOOKING_IN_PAST | 400 | Show "Cannot book in the past" |
| BARBER_UNAVAILABLE | 400 | Show "Barber not available at this time" |
| BARBER_NOT_ACTIVE | 400 | Show "Barber is not accepting bookings" |
| OVERLAPPING_APPOINTMENT | 409 | Show "Time slot no longer available" |
| CONCURRENT_MODIFICATION | 409 | Show "Please try again" |

**Frontend Notes:**
- For CUSTOMER: customerId = current user's ID
- On success, redirect to payment flow
- On OVERLAPPING_APPOINTMENT, refresh slots and show message

---

#### POST /appointments/:id/pay

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | CUSTOMER (own), BARBER (own appointments), SHOP_OWNER (shop appointments), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
{
  "clientSecret": "string (Stripe PaymentIntent client secret)"
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "You cannot pay for this appointment" |
| APPOINTMENT_NOT_FOUND | 404 | Show "Appointment not found" |
| INVALID_APPOINTMENT_STATE | 400 | Show "Appointment cannot be paid" |
| PAYMENT_ALREADY_EXISTS | 409 | Show "Payment already initiated" |
| STRIPE_ERROR | 500 | Show "Payment service error, try again" |

**Frontend Notes:**
- Use clientSecret with Stripe.js to render payment form
- On Stripe success, appointment will auto-confirm via webhook
- Poll or use websocket to detect CONFIRMED status

---

#### POST /appointments/:id/cancel

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | CUSTOMER (own), BARBER (own appointments), SHOP_OWNER (shop appointments), ADMIN |

**Request Body (optional):**
```json
{
  "reason": "string (optional)"
}
```

**Success Response (200):**
```json
{
  "id": "string",
  "status": "CANCELLED",
  "cancellationReason": "string | null",
  "payment": {
    "status": "PAID | REFUNDED"
  }
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "You cannot cancel this appointment" |
| APPOINTMENT_NOT_FOUND | 404 | Show "Appointment not found" |
| INVALID_APPOINTMENT_STATE | 400 | Show "Appointment cannot be cancelled" |
| CANCELLATION_WINDOW_PASSED | 400 | Show "Cannot cancel after appointment start" |
| STRIPE_ERROR | 500 | Show "Refund failed, contact support" |

**Frontend Notes:**
- Show refund policy before confirming (≥24h = refund, <24h = no refund)
- Display payment.status to show if refund was issued
- Disable cancel button based on UI State Rules

---

#### POST /appointments/:id/complete

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | BARBER (own), SHOP_OWNER (shop), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
{
  "id": "string",
  "status": "COMPLETED"
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "Permission denied" |
| APPOINTMENT_NOT_FOUND | 404 | Show "Appointment not found" |
| APPOINTMENT_ALREADY_COMPLETED | 400 | Show "Already completed" |

**Frontend Notes:**
- Only show for BARBER/SHOP_OWNER roles
- Only enable when status is BOOKED or CONFIRMED

---

#### POST /appointments/:id/no-show

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | BARBER (own), SHOP_OWNER (shop), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
{
  "id": "string",
  "status": "NO_SHOW"
}
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "Permission denied" |
| APPOINTMENT_NOT_FOUND | 404 | Show "Appointment not found" |
| APPOINTMENT_ALREADY_COMPLETED | 400 | Show "Cannot mark as no-show" |
| BOOKING_IN_PAST | 400 | Show "Cannot mark before appointment time" |

**Frontend Notes:**
- Only show for BARBER/SHOP_OWNER roles
- Only enable after appointment start time has passed
- Show confirmation dialog (affects customer's no-show count)

---

### 1.5 Appointment Reads (Role-Based)

#### GET /appointments/me (CUSTOMER)

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | CUSTOMER |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string",
    "startTime": "ISO 8601",
    "endTime": "ISO 8601",
    "status": "BOOKED | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW",
    "cancellationReason": "string | null",
    "barber": {
      "user": { "email": "string" },
      "shop": { "name": "string", "address": "string" }
    },
    "service": { "name": "string", "priceCents": "number" },
    "payment": { "status": "string" } | null
  }
]
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |

**Frontend Notes:**
- Sort by startTime descending (newest first)
- Group by upcoming vs past
- Show payment status badge

**NOTE:** This endpoint needs to be implemented in backend.

---

#### GET /barbers/:barberId/appointments (BARBER)

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | BARBER (own), SHOP_OWNER (shop barbers), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string",
    "startTime": "ISO 8601",
    "endTime": "ISO 8601",
    "status": "BOOKED | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW",
    "customer": { "id": "string", "email": "string" },
    "service": { "name": "string", "durationMinutes": "number" }
  }
]
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "Permission denied" |

**Frontend Notes:**
- Default to today's appointments
- Allow date filtering
- Color-code by status

---

#### GET /shops/:shopId/appointments (SHOP_OWNER)

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | SHOP_OWNER (own shop), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string",
    "startTime": "ISO 8601",
    "endTime": "ISO 8601",
    "status": "string",
    "customer": { "email": "string" },
    "barber": { "user": { "email": "string" } },
    "service": { "name": "string" }
  }
]
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "Permission denied" |

**Frontend Notes:**
- Show all barbers' appointments
- Allow filtering by barber, date, status
- Support date range queries

---

### 1.6 Availability Management (Staff Only)

#### GET /barbers/:barberId/availability

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | BARBER (own), SHOP_OWNER (shop barbers), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string",
    "dayOfWeek": 0-6,
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "barberId": "string"
  }
]
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "Permission denied" |

**Frontend Notes:**
- Display as weekly schedule grid
- dayOfWeek: 0 = Sunday, 6 = Saturday

---

#### GET /shops/:shopId/availability

| Property | Value |
|----------|-------|
| Auth Required | Yes |
| Allowed Roles | SHOP_OWNER (own shop), ADMIN |

**Request Body:** None

**Success Response (200):**
```json
[
  {
    "id": "string",
    "dayOfWeek": 0-6,
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "barberId": "string"
  }
]
```

**Possible Errors:**
| Code | HTTP | UI Behavior |
|------|------|-------------|
| UNAUTHORIZED | 401 | Redirect to login |
| FORBIDDEN | 403 | Show "Permission denied" |

**Frontend Notes:**
- Aggregate view across all barbers
- Allow drill-down to individual barber

---

## 2. Error Contract (LOCKED)

### 2.1 Standard Error Response Shape

**All API errors MUST follow this format:**

```json
{
  "error": {
    "code": "STRING_ENUM",
    "message": "Human readable description"
  }
}
```

### 2.2 Error Code Reference

| Code | HTTP Status | Category | UI Behavior |
|------|-------------|----------|-------------|
| `VALIDATION_ERROR` | 400 | Input | Show field-level validation errors |
| `UNAUTHORIZED` | 401 | Auth | Clear token, redirect to login |
| `FORBIDDEN` | 403 | Auth | Show "Permission denied" message |
| `INVALID_CREDENTIALS` | 401 | Auth | Show "Invalid email or password" |
| `EMAIL_ALREADY_EXISTS` | 409 | Auth | Show "Email already registered" |
| `APPOINTMENT_NOT_FOUND` | 404 | Resource | Show "Appointment not found" |
| `BARBER_NOT_FOUND` | 404 | Resource | Show "Barber not found" |
| `SERVICE_NOT_FOUND` | 404 | Resource | Show "Service not found" |
| `CUSTOMER_NOT_FOUND` | 404 | Resource | Show "Customer not found" |
| `BOOKING_IN_PAST` | 400 | Business | Show "Cannot book in the past" |
| `BARBER_UNAVAILABLE` | 400 | Business | Show "Barber not available at this time" |
| `BARBER_NOT_ACTIVE` | 400 | Business | Show "Barber is not accepting bookings" |
| `OVERLAPPING_APPOINTMENT` | 409 | Business | Refresh slots, show "Time slot taken" |
| `CONCURRENT_MODIFICATION` | 409 | Business | Show "Please try again" |
| `INVALID_APPOINTMENT_STATE` | 400 | Business | Show "Action not allowed for this appointment" |
| `APPOINTMENT_ALREADY_CANCELLED` | 400 | Business | Show "Appointment already cancelled" |
| `APPOINTMENT_ALREADY_COMPLETED` | 400 | Business | Show "Appointment already completed" |
| `CANNOT_CANCEL_PAST_APPOINTMENT` | 400 | Business | Show "Cannot cancel past appointments" |
| `CANCELLATION_WINDOW_PASSED` | 400 | Business | Show "Cancellation window has passed" |
| `PAYMENT_ALREADY_EXISTS` | 409 | Payment | Show "Payment already initiated" |
| `STRIPE_ERROR` | 500 | Payment | Show "Payment error, please try again" |
| `INVALID_DATE_RANGE` | 400 | Input | Show "Please select valid dates" |
| `INTERNAL_ERROR` | 500 | System | Show "Something went wrong, please try again" |

### 2.3 Error Handling Implementation (LOCKED)

```
Frontend Error Handler Pseudocode:

1. If status === 401:
   - Clear auth token
   - Redirect to /login
   - Show toast "Session expired"

2. If status === 403:
   - Show error message from response
   - Do NOT redirect (user is authenticated)

3. If status === 409 AND code === OVERLAPPING_APPOINTMENT:
   - Refresh available slots
   - Show toast "Slot no longer available"
   - Keep user on booking page

4. If status >= 500:
   - Log error for debugging
   - Show generic "Something went wrong" message
   - Offer retry option

5. For all other errors:
   - Display error.message to user
   - Do NOT expose technical details
```

---

## 3. Role-Based UI Flows

### 3.1 CUSTOMER Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     CUSTOMER JOURNEY                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. ENTRY                                                   │
│     ├── Landing Page (unauthenticated)                      │
│     ├── Register → POST /auth/register                      │
│     └── Login → POST /auth/login                            │
│                                                             │
│  2. BROWSE                                                  │
│     ├── View Shops → GET /shops                             │
│     ├── Select Shop → View Details                          │
│     ├── View Barbers → GET /shops/:shopId/barbers           │
│     └── View Services → GET /shops/:shopId/services         │
│                                                             │
│  3. BOOK                                                    │
│     ├── Select Barber                                       │
│     ├── Select Service                                      │
│     ├── View Slots → GET /barbers/:barberId/slots           │
│     ├── Select Time Slot                                    │
│     └── Create Booking → POST /appointments                 │
│                                                             │
│  4. PAY                                                     │
│     ├── Initiate Payment → POST /appointments/:id/pay       │
│     ├── Complete Stripe Payment (client-side)               │
│     └── Wait for Confirmation (webhook auto-confirms)       │
│                                                             │
│  5. MANAGE                                                  │
│     ├── View Appointments → GET /appointments/me            │
│     ├── View Appointment Details                            │
│     └── Cancel Appointment → POST /appointments/:id/cancel  │
│                                                             │
│  6. STATUS TRACKING                                         │
│     ├── BOOKED → Awaiting payment                           │
│     ├── CONFIRMED → Payment received, appointment set       │
│     ├── CANCELLED → User or system cancelled                │
│     ├── COMPLETED → Service delivered                       │
│     └── NO_SHOW → Customer did not appear                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 BARBER Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      BARBER JOURNEY                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. ENTRY                                                   │
│     └── Login → POST /auth/login                            │
│                                                             │
│  2. DASHBOARD                                               │
│     ├── View Today's Appointments                           │
│     │   └── GET /barbers/:barberId/appointments             │
│     ├── Filter by Date                                      │
│     └── View Appointment Details                            │
│                                                             │
│  3. APPOINTMENT ACTIONS                                     │
│     ├── Mark Complete → POST /appointments/:id/complete     │
│     ├── Mark No-Show → POST /appointments/:id/no-show       │
│     └── Cancel → POST /appointments/:id/cancel              │
│                                                             │
│  4. AVAILABILITY                                            │
│     └── View Schedule → GET /barbers/:barberId/availability │
│                                                             │
│  5. STATUS INDICATORS                                       │
│     ├── BOOKED → Yellow (awaiting payment)                  │
│     ├── CONFIRMED → Green (ready for service)               │
│     ├── CANCELLED → Grey (no action needed)                 │
│     ├── COMPLETED → Blue (done)                             │
│     └── NO_SHOW → Red (customer absent)                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 SHOP_OWNER Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    SHOP OWNER JOURNEY                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. ENTRY                                                   │
│     └── Login → POST /auth/login                            │
│                                                             │
│  2. DASHBOARD                                               │
│     ├── Shop Overview                                       │
│     │   ├── Total appointments today                        │
│     │   ├── Revenue summary (from completed)                │
│     │   └── No-show count                                   │
│     └── All Appointments → GET /shops/:shopId/appointments  │
│                                                             │
│  3. BARBER MANAGEMENT                                       │
│     ├── View All Barbers → GET /shops/:shopId/barbers       │
│     ├── View Barber Schedule                                │
│     │   └── GET /barbers/:barberId/appointments             │
│     └── View Barber Availability                            │
│         └── GET /barbers/:barberId/availability             │
│                                                             │
│  4. SHOP-WIDE AVAILABILITY                                  │
│     └── GET /shops/:shopId/availability                     │
│                                                             │
│  5. APPOINTMENT ACTIONS (any barber in shop)                │
│     ├── Mark Complete → POST /appointments/:id/complete     │
│     ├── Mark No-Show → POST /appointments/:id/no-show       │
│     └── Cancel → POST /appointments/:id/cancel              │
│                                                             │
│  6. REPORTING                                               │
│     ├── Filter by barber                                    │
│     ├── Filter by date range                                │
│     └── Filter by status                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. UI State Rules (LOCKED)

### 4.1 Appointment Status Definitions

| Status | Description | Terminal? |
|--------|-------------|-----------|
| `BOOKED` | Appointment created, awaiting payment | No |
| `CONFIRMED` | Payment received, appointment confirmed | No |
| `CANCELLED` | Appointment cancelled (by user or system) | Yes |
| `COMPLETED` | Service delivered successfully | Yes |
| `NO_SHOW` | Customer did not appear | Yes |

### 4.2 Action Availability Matrix

#### CUSTOMER Actions

| Status | View | Cancel | Pay |
|--------|------|--------|-----|
| BOOKED | ✅ | ✅ (before start) | ✅ |
| CONFIRMED | ✅ | ✅ (before start) | ❌ |
| CANCELLED | ✅ | ❌ | ❌ |
| COMPLETED | ✅ | ❌ | ❌ |
| NO_SHOW | ✅ | ❌ | ❌ |

#### BARBER Actions

| Status | View | Cancel | Complete | No-Show |
|--------|------|--------|----------|---------|
| BOOKED | ✅ | ✅ (before start) | ✅ | ✅ (after start) |
| CONFIRMED | ✅ | ✅ (before start) | ✅ | ✅ (after start) |
| CANCELLED | ✅ | ❌ | ❌ | ❌ |
| COMPLETED | ✅ | ❌ | ❌ | ❌ |
| NO_SHOW | ✅ | ❌ | ❌ | ❌ |

#### SHOP_OWNER Actions

| Status | View | Cancel | Complete | No-Show |
|--------|------|--------|----------|---------|
| BOOKED | ✅ | ✅ (before start) | ✅ | ✅ (after start) |
| CONFIRMED | ✅ | ✅ (before start) | ✅ | ✅ (after start) |
| CANCELLED | ✅ | ❌ | ❌ | ❌ |
| COMPLETED | ✅ | ❌ | ❌ | ❌ |
| NO_SHOW | ✅ | ❌ | ❌ | ❌ |

### 4.3 Conditional Rules

#### Cancel Button Logic
```
ENABLED if:
  - status IN (BOOKED, CONFIRMED)
  - AND now < appointment.startTime

DISABLED if:
  - status IN (CANCELLED, COMPLETED, NO_SHOW)
  - OR now >= appointment.startTime
```

#### Complete Button Logic (BARBER/SHOP_OWNER only)
```
ENABLED if:
  - status IN (BOOKED, CONFIRMED)

DISABLED if:
  - status IN (CANCELLED, COMPLETED, NO_SHOW)
```

#### No-Show Button Logic (BARBER/SHOP_OWNER only)
```
ENABLED if:
  - status IN (BOOKED, CONFIRMED)
  - AND now >= appointment.startTime

DISABLED if:
  - status IN (CANCELLED, COMPLETED, NO_SHOW)
  - OR now < appointment.startTime
```

#### Pay Button Logic (CUSTOMER only)
```
ENABLED if:
  - status === BOOKED
  - AND no payment exists

DISABLED if:
  - status !== BOOKED
  - OR payment exists
```

### 4.4 Important Implementation Note (LOCKED)

```
┌────────────────────────────────────────────────────────────────────┐
│                    CRITICAL: ENFORCEMENT MODEL                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Frontend disables actions for USER EXPERIENCE only.               │
│                                                                    │
│  Backend ALWAYS enforces rules regardless of frontend state.       │
│                                                                    │
│  If frontend sends an invalid request:                             │
│    - Backend rejects with appropriate error code                   │
│    - Frontend displays error message                               │
│    - Frontend refreshes appointment state                          │
│                                                                    │
│  NEVER trust frontend state for authorization decisions.           │
│  NEVER skip backend validation even if frontend "should" block it. │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.5 State Transition Diagram

```
                    ┌─────────────┐
                    │   BOOKED    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ CANCELLED│ │ CONFIRMED│ │ COMPLETED│
        └──────────┘ └────┬─────┘ └──────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ CANCELLED│ │ COMPLETED│ │  NO_SHOW │
        └──────────┘ └──────────┘ └──────────┘

Transitions:
  BOOKED → CONFIRMED    (via Stripe webhook on payment success)
  BOOKED → CANCELLED    (via cancel endpoint)
  BOOKED → COMPLETED    (via complete endpoint - rare, skip payment)
  CONFIRMED → CANCELLED (via cancel endpoint, with refund if ≥24h)
  CONFIRMED → COMPLETED (via complete endpoint)
  CONFIRMED → NO_SHOW   (via no-show endpoint or auto-detection)
```

---

## 5. Backend Endpoints Needing Implementation

The following endpoint was referenced but does not exist in the current backend:

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /appointments/me` | **NOT IMPLEMENTED** | Required for customer dashboard |

**Recommendation:** Implement before frontend development begins.

---

## 6. Summary

This document defines:

1. **15 API endpoints** for frontend consumption
2. **18 error codes** with standardized handling
3. **3 role-based UI flows** (CUSTOMER, BARBER, SHOP_OWNER)
4. **5 appointment statuses** with action availability rules
5. **Strict enforcement model** (frontend UX, backend enforces)

All sections marked **LOCKED** are final and form the contract between frontend and backend.

---

**Phase 7.1 complete — API contract and UI flow locked.**
