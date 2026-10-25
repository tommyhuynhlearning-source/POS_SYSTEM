# Counterpoint POS

On-premises restaurant management and ordering starter. One shared web app and service stack can host multiple restaurants; every owner account is restricted to its own restaurant. A restaurant can use the dashboard without operating the POS at its counter.

## Run with Docker

1. Install Docker Engine/Desktop with Compose.
2. Copy `.env.example` to `.env` and set a unique PostgreSQL password and JWT secret.
3. Start the services with `docker compose up -d --build`.
4. Open `http://localhost:8080/dashboard` and create a restaurant account. Registration creates the restaurant, owner login and unique public menu slug immediately.

The public order URL appears in the restaurant dashboard as `/order/{slug}`. Online ordering starts disabled; owners can enable or pause it from **Online ordering**. PostgreSQL persists in the `postgres_data` volume. `docker compose down` keeps data; `docker compose down -v` erases it.

## Separate restaurant interfaces

- **Dashboard:** `http://localhost:8080/dashboard` for the owner to manage the restaurant.
- **POS:** `http://localhost:8080/pos` for in-store sales. It has a left Food/Settings/Storage rail, center work area, right order cart and a separate checkout page.
- Both interfaces authenticate the restaurant owner and use shared services with tenant-scoped data. A separate cashier account/role is not implemented yet.

## Dashboard features

- Revenue for today, this month and this year uses `APP_TIMEZONE` and counts paid transactions only.
- POS cash sales count as paid after the owner confirms the cash was received. Dashboard users can also record cash sales made outside the POS.
- Owners manage dishes in a table, add dishes and set availability.
- Owners can enable or disable the public ordering page.
- Promotions can be sent by email or SMS to customers who opted in during online checkout. Configure SMTP or Twilio credentials in `.env`; the integrations are not active until configured.
- POS checkout shows Cash, Card, QR and Gift. Cash works without a terminal and requires the signed-in owner to confirm receipt; Card, QR and Gift stay unavailable until their provider or gift-card redemption is configured. Online checkout remains awaiting payment until an online payment provider is connected.

## Services and data

- `apps/web`: responsive React/TypeScript application for restaurant management, POS and customer ordering.
- `services/catalog`: restaurant accounts, tenant-scoped menus and public ordering links.
- `services/orders`: orders, receipts, sales totals and promotion delivery.
- Catalog and Orders each own a separate PostgreSQL database. Only the web service is exposed on the host; APIs and PostgreSQL stay on the private Compose network.

Set `APP_TIMEZONE` and `CURRENCY` before building. SMTP/Twilio settings are optional. Cloud deployment is intentionally out of scope for this on-premises phase.
