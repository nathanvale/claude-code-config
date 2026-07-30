# BFT / Glofox API

## Status

- Captured from Nathan's iOS apps on 2026-07-30.
- Confirmed authenticated login, timetable reads, booking, and cancellation outside the app.
- Never store passwords, bearer tokens, refresh tokens, cookies, or raw capture files here.

## Authentication

- Login: `POST https://auth.glofox.com/login?as=member`
- Request JSON keys: `branch_id`, `device`, `login`, `namespace`, `password`
- Response JSON keys: `refresh_token`, `success`, `token`, `user`
- Authenticated Glofox reads use `Authorization: Bearer …`.
- Include captured `x-glofox-*` headers required by the selected call.
- Tokens expire. Renew through login or refresh; keep credentials in 1Password or the OS keychain.

## Sessions

- Glofox timetable: `GET https://api.glofox.com/2.0/branches/{branch_id}/events/`
- Hapana timetable: `GET https://app.hapana.com/v2/site/sessions`
- My bookings: `GET https://api.glofox.com/2.0/bookings`

## Book And Cancel

- Book: `POST https://api.glofox.com/2.0/bookings`
- Request JSON keys:
  - `guest_bookings`
  - `join_waiting_list`
  - `model`
  - `model_id`
  - `pay_gym`
  - `payment_method`
- Cancel: `DELETE https://api.glofox.com/2.0/bookings/{booking_id}`
- Verified both mutations returned HTTP 200.
- Verified upcoming-booking count returned to zero after cancellation.

## Waiting List

- Expected join call: the booking `POST /2.0/bookings` request with `join_waiting_list: true`.
- A live waitlist join was not verified: Elsternwick had no full or waitlisted session in the next 14 days, and nearby branches had no full session tomorrow morning.
- Before live use:
  1. Confirm the event is full and waitlisting is offered.
  2. Submit the booking payload with `join_waiting_list: true`.
  3. Verify the response identifies a waiting-list booking.
  4. Discover and verify the leave-waitlist mutation.
  5. Restore the account to its starting state after testing.

## Other Captured Reads

- Member profile
- Memberships and stacked memberships
- Credits and charges
- Agreements, waivers, and consents
- Products, add-ons, services, and payment methods

