# Counterpoint POS

On-premises restaurant management, table reservations and POS starter. One shared web app and service stack can host multiple restaurants; every owner account is restricted to its own restaurant. A restaurant can use the dashboard without operating the POS at its counter.

## Run with Docker

1. Install Docker Engine/Desktop with Compose.
2. Copy `.env.example` to `.env` and set a unique PostgreSQL password and JWT secret.
3. Start the services with `docker compose up -d --build`.
4. Open `http://localhost:8080/dashboard` and create a restaurant account. Registration creates the restaurant, owner login and unique public reservation slug immediately.

The public table reservation URL appears in the restaurant dashboard as `/reserve/{slug}`. Online reservations start disabled; owners can enable or pause them from **Reservation settings**. PostgreSQL persists in the `postgres_data` volume. `docker compose down` keeps data; `docker compose down -v` erases it.

## Separate restaurant interfaces

- **Dashboard:** `http://localhost:8080/dashboard` for the owner to manage the restaurant.
- **POS:** `http://localhost:8080/pos` for in-store sales. Staff choose a table, add dishes to that table's order, then check out on a separate page.
- Both interfaces authenticate the restaurant owner and use shared services with tenant-scoped data. A separate cashier account/role is not implemented yet.

## Dashboard features

- Revenue for today, this month and this year uses `APP_TIMEZONE` and counts paid transactions only.
- POS cash sales count as paid after the owner confirms the cash was received. Dashboard users can also record cash sales made outside the POS.
- Owners manage dishes in a table, add dishes and set availability.
- Owners can enable or disable public table reservations, configure table count and opening hours.
- Reservations use one-hour slots, and the server assigns an available table before confirming.
- Promotions can be sent by email or SMS to customers with stored opt-ins. The reservation form does not collect opt-ins yet, so new reservations do not create promotion recipients. Configure SMTP or Twilio credentials in `.env` before sending.
- POS checkout shows Cash, Card, QR and Gift. Cash works without a terminal and requires the signed-in owner to confirm receipt; Card, QR and Gift stay unavailable until their provider or gift-card redemption is configured.
- Open table orders are currently held in browser memory until checkout. Reloading or changing POS devices before checkout loses those items, though the table session remains open.

## Services and data

- `apps/web`: responsive React/TypeScript application for restaurant management, POS and customer reservations.
- `services/catalog`: restaurant accounts, tenant-scoped menus and public reservation links.
- `services/orders`: reservations, table sessions, orders, receipts, sales totals and promotion delivery.
- Catalog and Orders each own a separate PostgreSQL database. Only the web service is exposed on the host; APIs and PostgreSQL stay on the private Compose network.

Set `APP_TIMEZONE` and `CURRENCY` before building. SMTP/Twilio settings are optional. Cloud deployment is intentionally out of scope for this on-premises phase.
