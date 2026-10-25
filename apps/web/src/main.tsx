import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownLeft,
  ArrowRight,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  LayoutDashboard,
  LogOut,
  Minus,
  Plus,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  Utensils,
  Users,
} from "lucide-react";
import "./style.css";
type Dish = {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  available: boolean;
};
type User = {
  id: string;
  email: string;
  role: string;
  restaurantId: string | null;
  restaurantName: string;
  status: string;
  slug: string | null;
};
const currency = (import.meta as any).env.VITE_CURRENCY || "USD";
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const locale = currency === "VND" ? "vi-VN" : "en-US";
const minorFactor =
  10 **
  (new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2);
const timezone = (import.meta as any).env.VITE_TIMEZONE || "UTC";
const restaurantDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
const money = (n: number) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    n / minorFactor,
  );
const token = () => localStorage.getItem("pos_token") || "";
async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...init.headers,
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
function App() {
  const path = location.pathname;
  const route = path.split("/").filter(Boolean)[0] || "login";
  const [page, setPage] = useState(
    path.startsWith("/reserve/") || path.startsWith("/order/")
      ? path.endsWith("/confirmed") && history.state?.reservation
        ? "reservationSuccess"
        : "reservation"
      : [
            "dashboard",
            "menu",
            "promotions",
            "settings",
            "register",
            "login",
            "checkout",
            "pos",
          ].includes(route)
        ? route
        : "login",
  );
  const [slug] = useState(
    path.startsWith("/order/") || path.startsWith("/reserve/")
      ? path.split("/")[2] || ""
      : "",
  );
  const [user, setUser] = useState<User | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("pos_user") || "null");
    } catch {
      return null;
    }
  });
  const [restaurant, setRestaurant] = useState<any>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState("All dishes");
  const [posSection, setPosSection] = useState<
    "tables" | "food" | "reservations" | "settings" | "storage"
  >("tables");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobileCart, setMobileCart] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "CARD" | "QR" | "GIFT"
  >("CASH");
  const [orders, setOrders] = useState<any[]>([]);
  const [tables, setTables] = useState<any>({ occupied: [], reserved: [] });
  const [reservations, setReservations] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [publicMenu, setPublicMenu] = useState<any>(null);
  const [success, setSuccess] = useState<any>(null);
  const [bookingDate, setBookingDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return localDate(date);
  });
  const [availability, setAvailability] = useState<any[]>([]);
  const [selectedTime, setSelectedTime] = useState("");
  const [reservationResult, setReservationResult] = useState<any>(
    () => history.state?.reservation || null,
  );
  const [onlinePaymentMethod, setOnlinePaymentMethod] = useState<
    "COD" | "CARD" | "QR"
  >("COD");
  const setField = (k: string, v: any) =>
    setForm((x: any) => ({ ...x, [k]: v }));
  const go = (p: string) => {
    setPage(p);
    const target =
      p === "reservation"
        ? `/reserve/${slug}`
        : p === "reservationSuccess"
          ? `/reserve/${slug}/confirmed`
          : p === "online"
            ? `/order/${slug}`
            : p === "checkout" && slug
              ? `/order/${slug}/checkout`
              : `/${p === "pos" ? "pos" : p}`;
    history.pushState({}, "", target);
    setNotice("");
  };
  useEffect(() => {
    if (location.pathname.startsWith("/order/") && slug)
      history.replaceState({}, "", `/reserve/${slug}`);
    if (
      location.pathname.endsWith("/confirmed") &&
      !history.state?.reservation &&
      slug
    )
      history.replaceState({}, "", `/reserve/${slug}`);
    const f = () => {
      const reservationRoute =
        location.pathname.startsWith("/reserve/") ||
        location.pathname.startsWith("/order/");
      const confirmation = history.state?.reservation || null;
      setReservationResult(confirmation);
      setPage(
        reservationRoute
          ? location.pathname.endsWith("/confirmed") && confirmation
            ? "reservationSuccess"
            : "reservation"
          : location.pathname.slice(1) || "pos",
      );
    };
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  const load = async (u = user) => {
    if (!u) return;
    try {
      const m = await api("/api/catalog/me");
      setRestaurant(m.restaurant);
      if (m.restaurant?.id) {
        setDishes(
          await api(`/api/catalog/restaurants/${m.restaurant.id}/dishes`),
        );
        const [tableData, reservationData] = await Promise.all([
          api(`/api/orders/${m.restaurant.id}/tables`),
          api(`/api/orders/${m.restaurant.id}/reservations`),
        ]);
        setTables(tableData);
        setReservations(reservationData);
        setOrders(await api(`/api/orders/${m.restaurant.id}`));
        setRevenue(await api(`/api/orders/${m.restaurant.id}/revenue`));
        setCampaigns(await api(`/api/orders/${m.restaurant.id}/promotions`));
      }
    } catch (e: any) {
      if (e.message === "Please sign in again") {
        localStorage.clear();
        setUser(null);
        setPage("login");
        history.replaceState({}, "", "/login");
      }
      setNotice(e.message);
    }
  };
  useEffect(() => {
    if (user) load(user);
  }, [user]);
  useEffect(() => {
    if (page !== "pos" || !restaurant?.id) return;
    const timer = window.setInterval(
      () =>
        Promise.all([
          api(`/api/orders/${restaurant.id}/tables`).then(setTables),
          api(`/api/orders/${restaurant.id}/reservations`).then(
            setReservations,
          ),
        ]).catch((e: any) => setNotice(e.message)),
      10000,
    );
    return () => window.clearInterval(timer);
  }, [page, posSection, restaurant?.id]);
  useEffect(() => {
    if (
      (page === "online" || page === "checkout" || page === "reservation") &&
      slug
    )
      api(`/api/catalog/public/${slug}`)
        .then(setPublicMenu)
        .catch((e: any) => setNotice(e.message));
  }, [page, slug]);
  useEffect(() => {
    if (page !== "reservation" || !slug || !bookingDate) return;
    api(
      `/api/orders/public/${encodeURIComponent(slug)}/availability?date=${bookingDate}`,
    )
      .then((data) => {
        setAvailability(data.slots || []);
        setSelectedTime((current: string) =>
          data.slots?.some(
            (slot: any) => slot.time === current && slot.availableCount > 0,
          )
            ? current
            : "",
        );
      })
      .catch((e: any) => setNotice(e.message));
  }, [page, slug, bookingDate]);
  const picked = useMemo<Dish[]>(() => {
    const source = slug ? publicMenu?.dishes || [] : dishes;
    return source.filter((d: Dish) => cart[d.id]);
  }, [dishes, cart, publicMenu, slug]);
  const total = picked.reduce((n, d) => n + d.priceMinor * cart[d.id], 0);
  const filtered = dishes.filter(
    (d) =>
      (category === "All dishes" || category === "Available"
        ? category === "All dishes" || d.available
        : true) && d.name.toLowerCase().includes(search.toLowerCase()),
  );
  const login = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api("/api/catalog/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem("pos_token", d.token);
      localStorage.setItem("pos_user", JSON.stringify(d.user));
      setUser(d.user);
      const next = location.pathname === "/pos" ? "pos" : "dashboard";
      setPage(next);
      history.pushState({}, "", `/${next}`);
    } catch (x: any) {
      setNotice(x.message);
    } finally {
      setLoading(false);
    }
  };
  const register = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api("/api/catalog/register", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setNotice(d.message);
      setPage("login");
    } catch (x: any) {
      setNotice(x.message);
    } finally {
      setLoading(false);
    }
  };
  const logout = () => {
    localStorage.clear();
    setUser(null);
    setPage("login");
    history.pushState({}, "", "/login");
  };
  const addDish = async (e: any) => {
    e.preventDefault();
    if (!restaurant?.id) return;
    try {
      await api(`/api/catalog/restaurants/${restaurant.id}/dishes`, {
        method: "POST",
        body: JSON.stringify({
          name: form.dishName,
          description: form.description,
          priceMinor: Math.round(Number(form.price) * minorFactor),
        }),
      });
      setField("dishName", "");
      setField("description", "");
      setField("price", "");
      load();
    } catch (x: any) {
      setNotice(x.message);
    }
  };
  const selectTable = async (tableNumber: number) => {
    if (
      selectedTable !== tableNumber &&
      Object.values(cart).some((n) => n > 0)
    ) {
      setNotice(
        "Finish checkout for the current table before switching tables.",
      );
      return;
    }
    const occupied = tables.occupied.some(
      (table: any) => table.tableNumber === tableNumber,
    );
    if (!occupied) {
      try {
        await api(`/api/orders/${restaurant.id}/tables/${tableNumber}/open`, {
          method: "POST",
        });
        await api(`/api/orders/${restaurant.id}/tables`).then(setTables);
        setCart({});
      } catch (e: any) {
        setNotice(e.message);
        await api(`/api/orders/${restaurant.id}/tables`)
          .then(setTables)
          .catch(() => {});
        return;
      }
    }
    setSelectedTable(tableNumber);
    setPosSection("food");
  };
  const togglePublish = async () => {
    try {
      const d = await api(`/api/catalog/restaurants/${restaurant.id}/publish`, {
        method: "PATCH",
        body: JSON.stringify({ published: !restaurant.published }),
      });
      setRestaurant({ ...restaurant, ...d });
      setNotice("Online reservation availability updated");
    } catch (x: any) {
      setNotice(x.message);
    }
  };
  const submitOrder = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          slug,
          items: picked.map((x) => ({ id: x.id, quantity: cart[x.id] })),
          paymentMethod: onlinePaymentMethod,
          customer: {
            name: form.customerName,
            phone: form.phone,
            address: form.address,
            email: form.customerEmail,
            smsConsent: form.smsConsent === true,
            emailConsent: form.emailConsent === true,
          },
        }),
      });
      setSuccess(d);
      setCart({});
      if (user) load(user);
      setPage("success");
    } catch (x: any) {
      setNotice(x.message);
    } finally {
      setLoading(false);
    }
  };
  const submitReservation = async (e: any) => {
    e.preventDefault();
    if (!selectedTime) return setNotice("Choose an available time");
    setLoading(true);
    try {
      const result = await api(
        `/api/orders/public/${encodeURIComponent(slug)}/reservations`,
        {
          method: "POST",
          body: JSON.stringify({
            name: form.reservationName,
            phone: form.reservationPhone,
            partySize: Number(form.partySize || 2),
            date: bookingDate,
            time: selectedTime,
          }),
        },
      );
      const confirmation = {
        id: result.id,
        restaurantName: result.restaurantName,
        tableNumber: result.tableNumber,
        startAt: result.startAt,
      };
      setReservationResult(confirmation);
      history.pushState(
        { reservation: confirmation },
        "",
        `/reserve/${slug}/confirmed`,
      );
      setPage("reservationSuccess");
    } catch (e: any) {
      setNotice(e.message);
      api(
        `/api/orders/public/${encodeURIComponent(slug)}/availability?date=${bookingDate}`,
      )
        .then((data) => setAvailability(data.slots || []))
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  };
  if (page === "reservation" || page === "reservationSuccess") {
    return (
      <main className="reservationPage">
        <header className="reservationHeader">
          <a className="brand" href="/">
            <span className="brandIcon">
              <Utensils size={18} />
            </span>
            {publicMenu?.name || "Restaurant"}
          </a>
          <span>TABLE RESERVATIONS</span>
        </header>
        {notice && <div className="notice">{notice}</div>}
        {page === "reservationSuccess" ? (
          <section className="reservationSuccess">
            <div className="successIcon">
              <Check />
            </div>
            <p className="eyebrow">TABLE CONFIRMED</p>
            <h1>Your table is reserved.</h1>
            <p>
              {reservationResult
                ? `${reservationResult.restaurantName} · Table ${reservationResult.tableNumber} · ${restaurantDateTime(reservationResult.startAt)}`
                : "Your reservation was confirmed. Contact the restaurant if you need to make a change."}
            </p>
            {reservationResult && (
              <small>
                Confirmation {reservationResult.id.slice(0, 8).toUpperCase()}
              </small>
            )}
            <div>
              <button
                className="textButton"
                onClick={() => {
                  setReservationResult(null);
                  history.pushState({}, "", `/reserve/${slug}`);
                  setPage("reservation");
                }}
              >
                Make another reservation
              </button>
            </div>
          </section>
        ) : (
          <div className="reservationLayout">
            <section className="reservationIntro">
              <p className="eyebrow">A PLACE AT THE TABLE</p>
              <h1>
                Save your
                <br />
                seat.
              </h1>
              <p>{publicMenu?.name || "Restaurant"}</p>
              <p>{publicMenu?.address}</p>
            </section>
            <form className="reservationForm" onSubmit={submitReservation}>
              <div>
                <p className="eyebrow">ONLINE RESERVATION</p>
                <h2>Choose a time</h2>
                <p className="muted">
                  Available tables update by date and time.
                </p>
              </div>
              <label>
                Date
                <input
                  type="date"
                  min={localDate(new Date())}
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  required
                />
              </label>
              <div className="reservationSlotsLabel">
                <span>
                  Time ·{" "}
                  {availability.reduce(
                    (n, x) => n + (x.availableCount > 0 ? 1 : 0),
                    0,
                  )}{" "}
                  slots available · {timezone}
                </span>
                <span>
                  {availability.find((x) => x.time === selectedTime)
                    ?.availableCount || 0}{" "}
                  tables left
                </span>
              </div>
              <div className="reservationSlots">
                {availability.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={slot.availableCount === 0}
                    className={selectedTime === slot.time ? "selected" : ""}
                    onClick={() => setSelectedTime(slot.time)}
                  >
                    <b>{slot.time}</b>
                    <small>
                      {slot.availableCount}{" "}
                      {slot.availableCount === 1 ? "table" : "tables"}
                    </small>
                  </button>
                ))}
                {!availability.length && (
                  <p className="hint">
                    No reservation times are available for this date.
                  </p>
                )}
              </div>
              <div className="reservationFields">
                <label>
                  Your name
                  <input
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={form.reservationName || ""}
                    onChange={(e) =>
                      setField("reservationName", e.target.value)
                    }
                  />
                </label>
                <label>
                  Phone number
                  <input
                    autoComplete="tel"
                    type="tel"
                    required
                    maxLength={40}
                    value={form.reservationPhone || ""}
                    onChange={(e) =>
                      setField("reservationPhone", e.target.value)
                    }
                  />
                </label>
                <label>
                  Guests
                  <select
                    value={form.partySize || "2"}
                    onChange={(e) => setField("partySize", e.target.value)}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "guest" : "guests"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="primary full"
                disabled={!selectedTime || loading}
              >
                {loading ? "Confirming…" : "Confirm reservation"}
                <ArrowRight size={16} />
              </button>
              <p className="hint">
                Your booking is confirmed immediately when a table is available.
                No payment is needed now.
              </p>
            </form>
          </div>
        )}
      </main>
    );
  }
  if (page === "online")
    return (
      <main className="public publicOrder">
        <header className="publicHead">
          <a className="brand" href="#">
            <span className="brandIcon">
              <Utensils size={18} />
            </span>{" "}
            {publicMenu?.name || "Restaurant menu"}
          </a>
          <span className="publicHeadLabel">
            <span className="publicOpenDot" /> Ordering online
          </span>
        </header>
        {notice && <div className="notice">{notice}</div>}
        {publicMenu ? (
          <>
            <section className="publicIntro">
              <div className="publicIntroCopy">
                <p className="publicKicker">Made fresh at {publicMenu.name}</p>
                <h1>
                  Something good
                  <br />
                  is on the way.
                </h1>
                <p className="publicAddress">{publicMenu.address}</p>
              </div>
              <div className="plateMotif" aria-hidden="true">
                <span />
                <b>
                  GOOD
                  <br />
                  FOOD
                </b>
              </div>
            </section>
            <div className="publicGrid">
              <section className="publicMenuSection" id="menu">
                <div className="publicSectionHead">
                  <div>
                    <p className="publicKicker">From our kitchen</p>
                    <h2>Today’s menu</h2>
                  </div>
                  <span>
                    {publicMenu.dishes.length}{" "}
                    {publicMenu.dishes.length === 1 ? "dish" : "dishes"}
                  </span>
                </div>
                {publicMenu.dishes.length ? (
                  publicMenu.dishes.map((d: Dish) => (
                    <article className="publicDish" key={d.id}>
                      <span className="dishDot" aria-hidden="true" />
                      <div className="publicDishCopy">
                        <h3>{d.name}</h3>
                        <p>
                          {d.description || "Prepared fresh in our kitchen."}
                        </p>
                        <b>{money(d.priceMinor)}</b>
                      </div>
                      <div className="publicDishAction">
                        {cart[d.id] ? (
                          <div className="publicQuantity">
                            <button
                              aria-label={`Remove one ${d.name}`}
                              onClick={() =>
                                setCart((x) => ({
                                  ...x,
                                  [d.id]: Math.max(0, (x[d.id] || 0) - 1),
                                }))
                              }
                            >
                              <Minus size={15} />
                            </button>
                            <span>{cart[d.id]}</span>
                            <button
                              aria-label={`Add one ${d.name}`}
                              onClick={() =>
                                setCart((x) => ({
                                  ...x,
                                  [d.id]: (x[d.id] || 0) + 1,
                                }))
                              }
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                        ) : (
                          <button
                            className="round"
                            aria-label={`Add ${d.name}`}
                            onClick={() =>
                              setCart((x) => ({ ...x, [d.id]: 1 }))
                            }
                          >
                            <Plus size={18} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="publicNoDishes">
                    <ShoppingBag size={22} />
                    <p>No dishes are available just yet.</p>
                  </div>
                )}
              </section>
              <aside className="publicCart">
                <div className="publicCartHead">
                  <span className="publicCartIcon">
                    <ShoppingBag size={17} />
                  </span>
                  <div>
                    <h2>Your order</h2>
                    <small>
                      {picked.reduce((n, d) => n + cart[d.id], 0)} items
                    </small>
                  </div>
                </div>
                {picked.length ? (
                  <div className="publicCartLines">
                    {picked.map((d) => (
                      <div className="publicCartLine" key={d.id}>
                        <span>
                          {cart[d.id]} × {d.name}
                        </span>
                        <b>{money(d.priceMinor * cart[d.id])}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="publicCartEmpty">
                    Your order will show up here as you add dishes.
                  </div>
                )}
                <div className="totalLine">
                  <span>Total</span>
                  <b>{money(total)}</b>
                </div>
                <button
                  className="primary full publicCheckoutButton"
                  disabled={!picked.length}
                  onClick={() => go("checkout")}
                >
                  Continue to checkout <ArrowRight size={16} />
                </button>
                <p className="publicCartNote">
                  You’ll add your delivery details next.
                </p>
              </aside>
            </div>
            <button
              className="publicMobileCart"
              disabled={!picked.length}
              onClick={() => go("checkout")}
            >
              <span>
                <ShoppingBag size={17} />{" "}
                {picked.reduce((n, d) => n + cart[d.id], 0)} items
              </span>
              <b>{money(total)}</b>
              <strong>
                Checkout <ArrowRight size={15} />
              </strong>
            </button>
          </>
        ) : (
          <div className="centerState">{notice || "Loading menu…"}</div>
        )}
      </main>
    );
  if (page === "checkout" && slug) {
    return (
      <main className="public publicCheckout">
        <header className="publicHead">
          <button className="textButton" onClick={() => go("online")}>
            <ArrowDownLeft size={17} /> Back to menu
          </button>
          <span>
            {publicMenu?.name || "Your order"} <i>/</i> Checkout
          </span>
        </header>
        <form className="checkoutCard" onSubmit={submitOrder}>
          <p className="publicKicker">Almost there</p>
          <h1>Where should we bring it?</h1>
          <section className="checkoutSummary">
            <div className="checkoutSummaryHead">
              <b>Your order</b>
              <button
                type="button"
                className="textButton"
                onClick={() => go("online")}
              >
                Edit order
              </button>
            </div>
            {picked.map((d) => (
              <div className="checkoutSummaryLine" key={d.id}>
                <span>
                  {cart[d.id]} × {d.name}
                </span>
                <b>{money(d.priceMinor * cart[d.id])}</b>
              </div>
            ))}
            <div className="totalLine">
              <span>Total</span>
              <b>{money(total)}</b>
            </div>
          </section>
          <label>
            Full name
            <input
              autoComplete="name"
              required
              value={form.customerName || ""}
              onChange={(e) => setField("customerName", e.target.value)}
            />
          </label>
          <label>
            Phone number
            <input
              autoComplete="tel"
              required
              type="tel"
              value={form.phone || ""}
              onChange={(e) => setField("phone", e.target.value)}
            />
          </label>
          <label>
            Delivery address
            <input
              autoComplete="street-address"
              required
              value={form.address || ""}
              onChange={(e) => setField("address", e.target.value)}
            />
          </label>
          <label>
            Email (optional)
            <input
              autoComplete="email"
              type="email"
              value={form.customerEmail || ""}
              onChange={(e) => setField("customerEmail", e.target.value)}
            />
          </label>
          <div className="consentOptions">
            <label className="consent">
              <input
                type="checkbox"
                checked={!!form.emailConsent}
                onChange={(e) => setField("emailConsent", e.target.checked)}
              />{" "}
              Email me restaurant offers
            </label>
            <label className="consent">
              <input
                type="checkbox"
                checked={!!form.smsConsent}
                onChange={(e) => setField("smsConsent", e.target.checked)}
              />{" "}
              Text me restaurant offers
            </label>
          </div>
          <fieldset className="paymentMethods">
            <legend>How would you like to pay?</legend>
            <div className="paymentMethodGrid onlineMethods">
              {(["COD", "CARD", "QR"] as const).map((method) => (
                <button
                  type="button"
                  key={method}
                  className={
                    "paymentMethod " +
                    (onlinePaymentMethod === method ? "selected" : "")
                  }
                  onClick={() => setOnlinePaymentMethod(method)}
                  aria-pressed={onlinePaymentMethod === method}
                >
                  <span>
                    {method === "COD"
                      ? "Cash on delivery"
                      : method === "CARD"
                        ? "Card"
                        : "QR"}
                  </span>
                  <small>
                    {method === "COD"
                      ? "Pay when your order arrives"
                      : "Online payment"}
                  </small>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="paymentNote" role="status">
            {onlinePaymentMethod === "COD"
              ? "Pay cash when the restaurant delivers your order."
              : `${onlinePaymentMethod === "CARD" ? "Card" : "QR"} payment needs a connected payment provider.`}
          </p>
          {notice && <p className="error">{notice}</p>}
          <button
            className="primary full"
            disabled={
              !picked.length || loading || onlinePaymentMethod !== "COD"
            }
          >
            {loading
              ? "Submitting…"
              : onlinePaymentMethod === "COD"
                ? "Place COD order"
                : `${onlinePaymentMethod} payment unavailable`}{" "}
            <ArrowRight size={16} />
          </button>
          <p className="hint">
            Cash on delivery orders stay unpaid until the restaurant confirms
            the cash was received. Card and QR checkout are not connected yet.
          </p>
        </form>
      </main>
    );
  }
  if (page === "success")
    return (
      <main className={slug ? "public publicSuccess" : "centerState"}>
        <section className="centerState">
          <div className="successIcon">
            <Check />
          </div>
          <h1>Order received</h1>
          <p>
            {success?.paymentMethod === "COD"
              ? `Order ${success?.id?.slice(0, 8)} received. Pay cash when it arrives.`
              : success?.status === "PAID"
                ? `Order ${success?.id?.slice(0, 8)} paid with cash.`
                : `Order ${success?.id?.slice(0, 8)} is awaiting payment confirmation.`}
          </p>
          <button
            className="primary"
            onClick={() => (slug ? go("online") : go("pos"))}
          >
            {slug ? "Back to menu" : "New sale"}
          </button>
        </section>
      </main>
    );
  if (!user || page === "login" || page === "register")
    return (
      <main className="authPage">
        <div className="authFrame">
          <a className="brand">
            <span className="brandIcon">
              <Utensils size={18} />
            </span>{" "}
            COUNTERPOINT
          </a>
          <div className="authPanel">
            <p className="eyebrow">
              {page === "pos" ? "RESTAURANT POS" : "RESTAURANT DASHBOARD"}
            </p>
            <h1>
              {page === "register"
                ? "Start your restaurant profile"
                : page === "pos"
                  ? "Sign in to POS"
                  : "Welcome back"}
            </h1>
            <p className="muted">
              {page === "register"
                ? "Create your restaurant workspace and owner login."
                : page === "pos"
                  ? "Sign in to open this restaurant’s point of sale."
                  : "Sign in to manage your restaurant."}
            </p>
            <form onSubmit={page === "register" ? register : login}>
              {page === "register" && (
                <>
                  <label>
                    Restaurant name
                    <input
                      required
                      value={form.name || ""}
                      onChange={(e) => setField("name", e.target.value)}
                    />
                  </label>
                  <label>
                    Restaurant address
                    <input
                      required
                      value={form.address || ""}
                      onChange={(e) => setField("address", e.target.value)}
                    />
                  </label>
                  <label>
                    Restaurant phone
                    <input
                      required
                      type="tel"
                      value={form.phone || ""}
                      onChange={(e) => setField("phone", e.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                Email
                <input
                  required
                  type="email"
                  value={form.email || ""}
                  onChange={(e) => setField("email", e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  required
                  type="password"
                  minLength={page === "register" ? 12 : 1}
                  value={form.password || ""}
                  onChange={(e) => setField("password", e.target.value)}
                />
                {page === "register" && (
                  <small>Use at least 12 characters.</small>
                )}
              </label>
              {notice && <p className="error">{notice}</p>}
              <button className="primary full" disabled={loading}>
                {loading
                  ? "Please wait…"
                  : page === "register"
                    ? "Create account"
                    : "Sign in"}{" "}
                <ArrowRight size={16} />
              </button>
            </form>
            <p className="authSwitch">
              {page === "register" ? "Already have access?" : "New restaurant?"}{" "}
              <button
                onClick={() => {
                  setNotice("");
                  setPage(page === "register" ? "login" : "register");
                }}
              >
                {page === "register" ? "Sign in" : "Create restaurant account"}
              </button>
            </p>
            <p className="hint">
              Your restaurant dashboard is ready as soon as you create an
              account.
            </p>
          </div>
        </div>
      </main>
    );
  if (page === "checkout" && user) {
    return (
      <main className="posCheckoutShell" data-ui="pos-checkout">
        <header className="posTopbar">
          <button className="textButton" onClick={() => go("pos")}>
            <ArrowDownLeft size={16} /> Back to POS
          </button>
          <strong>
            {restaurant?.name || user.restaurantName}
            {selectedTable
              ? ` · Table ${String(selectedTable).padStart(2, "0")}`
              : ""}{" "}
            · Checkout
          </strong>
          <button className="textButton" onClick={logout}>
            <LogOut size={15} /> Sign out
          </button>
        </header>
        <form
          className="checkoutCard"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            try {
              const d = await api("/api/orders/staff", {
                method: "POST",
                body: JSON.stringify({
                  paymentMethod: "CASH",
                  tableNumber: selectedTable,
                  items: picked.map((x) => ({
                    id: x.id,
                    quantity: cart[x.id],
                  })),
                }),
              });
              setSuccess(d);
              setCart({});
              setSelectedTable(null);
              setPosSection("tables");
              if (user) load(user);
              setPage("success");
            } catch (x: any) {
              setNotice(x.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <p className="eyebrow">CHECKOUT</p>
          <h1>
            {selectedTable
              ? `Table ${String(selectedTable).padStart(2, "0")} · Review order`
              : "Review this order"}
          </h1>
          {picked.map((d) => (
            <div className="totalLine" key={d.id}>
              <span>
                {cart[d.id]} × {d.name}
              </span>
              <b>{money(d.priceMinor * cart[d.id])}</b>
            </div>
          ))}
          <div className="totalLine">
            <span>Total due</span>
            <b>{money(total)}</b>
          </div>
          <fieldset className="paymentMethods">
            <legend>Payment method</legend>
            <div className="paymentMethodGrid">
              {(["CASH", "CARD", "QR", "GIFT"] as const).map((method) => (
                <button
                  type="button"
                  key={method}
                  className={
                    "paymentMethod " +
                    (paymentMethod === method ? "selected" : "")
                  }
                  onClick={() => setPaymentMethod(method)}
                  aria-pressed={paymentMethod === method}
                >
                  <span>
                    {method === "CASH"
                      ? "Cash"
                      : method === "CARD"
                        ? "Card"
                        : method === "QR"
                          ? "QR"
                          : "Gift"}
                  </span>
                  <small>
                    {method === "CASH" ? "Available now" : "Setup required"}
                  </small>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="paymentNote" role="status">
            {paymentMethod === "CASH"
              ? "After receiving cash, confirm it here."
              : paymentMethod === "CARD"
                ? "Card payments need a connected card terminal or provider."
                : paymentMethod === "QR"
                  ? "QR payments need a configured payment provider."
                  : "Gift card balance and redemption are not set up yet."}
          </p>
          {notice && <p className="error">{notice}</p>}
          <button
            className="primary full"
            disabled={!picked.length || loading || paymentMethod !== "CASH"}
          >
            {loading
              ? "Saving…"
              : paymentMethod === "CASH"
                ? "Confirm cash received"
                : paymentMethod + " unavailable"}{" "}
            <ArrowRight size={16} />
          </button>
        </form>
      </main>
    );
  }
  const title =
    page === "dashboard"
      ? "Restaurant dashboard"
      : page === "menu"
        ? "Menu"
        : page === "promotions"
          ? "Promotions"
          : "Online bookings";
  return (
    <main
      className={
        page === "pos" ? "appShell posShell" : "appShell dashboardShell"
      }
      data-ui={page === "pos" ? "pos" : undefined}
    >
      {page !== "pos" && (
        <aside className="sideNav">
          <a className="brand">
            <span className="brandIcon">
              <Utensils size={18} />
            </span>
            <span>
              COUNTERPOINT<small>RESTAURANT DASHBOARD</small>
            </span>
          </a>
          <div className="navGroup">
            <p className="navLabel">RESTAURANT</p>
            <button
              className={page === "dashboard" ? "active" : ""}
              onClick={() => go("dashboard")}
            >
              <LayoutDashboard /> Dashboard
            </button>
            <button
              className={page === "menu" ? "active" : ""}
              onClick={() => go("menu")}
            >
              <Utensils /> Menu
            </button>
            <button
              className={page === "promotions" ? "active" : ""}
              onClick={() => go("promotions")}
            >
              <Receipt /> Promotions
            </button>
            <button
              onClick={() => go("settings")}
              className={page === "settings" ? "active" : ""}
            >
              <Settings /> Online bookings
            </button>
          </div>
          <div className="sideBottom">
            <div className="userChip">
              <span className="avatar">
                {(user?.restaurantName || "P").slice(0, 1)}
              </span>
              <span>
                {user?.restaurantName || "Restaurant"}
                <small>{user?.email}</small>
              </span>
              <ChevronDown size={15} />
            </div>
            <button onClick={logout}>
              <LogOut /> Sign out
            </button>
          </div>
        </aside>
      )}
      <section className="mainColumn">
        <header
          className={`topbar ${page === "pos" ? "posTopbar" : "dashboardTopbar"}`}
        >
          {page === "pos" ? (
            <>
              <div className="posBrand">
                <span className="brandIcon">
                  <Receipt size={17} />
                </span>
                <span>
                  COUNTERPOINT<small>POINT OF SALE</small>
                </span>
                <span className="posRestaurant">
                  {restaurant?.name || user?.restaurantName}
                </span>
              </div>
              <div className="topActions">
                <span>{user?.email}</span>
                <button className="textButton" onClick={logout}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="crumb">
                Restaurant dashboard <span>/</span> {title}
              </div>
              <div className="topActions">
                <span className="liveDot">●</span> Restaurant workspace{" "}
                <button
                  className="avatar topAvatar"
                  onClick={() => go("settings")}
                >
                  {(user?.restaurantName || "P").slice(0, 1)}
                </button>
              </div>
            </>
          )}
        </header>
        {notice && (
          <div className="notice inlineNotice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {page === "pos" && (
          <div
            className={`posLayout ${posSection === "food" ? "" : "fullWorkspace"}`}
          >
            <nav className="posRail" aria-label="POS sections">
              <button
                className={posSection === "tables" ? "active" : ""}
                onClick={() => setPosSection("tables")}
              >
                <CalendarDays size={20} />
                <span>Tables</span>
              </button>
              <button
                className={posSection === "food" ? "active" : ""}
                disabled={!selectedTable}
                onClick={() => setPosSection("food")}
              >
                <Utensils size={20} />
                <span>Order</span>
              </button>
              <button
                className={posSection === "settings" ? "active" : ""}
                onClick={() => setPosSection("settings")}
              >
                <Settings size={20} />
                <span>Settings</span>
              </button>
              <button
                className={posSection === "reservations" ? "active" : ""}
                onClick={() => setPosSection("reservations")}
              >
                <Users size={20} />
                <span>
                  Reservations
                  {reservations.some(
                    (booking) =>
                      booking.status === "CONFIRMED" &&
                      new Date(booking.startAt).getTime() > Date.now(),
                  ) ? (
                    <small className="navBadge">
                      {
                        reservations.filter(
                          (booking) =>
                            booking.status === "CONFIRMED" &&
                            new Date(booking.startAt).getTime() > Date.now(),
                        ).length
                      }
                    </small>
                  ) : null}
                </span>
              </button>
              <button
                className={posSection === "storage" ? "active" : ""}
                onClick={() => setPosSection("storage")}
              >
                <Boxes size={20} />
                <span>Storage</span>
              </button>
            </nav>
            {posSection === "tables" && (
              <section className="workspace tablesWorkspace">
                <div className="pageHeading">
                  <div>
                    <p className="eyebrow">FLOOR PLAN</p>
                    <h1>Tables</h1>
                    <p className="muted">
                      {restaurant?.tableCount || 0} tables · select a table to
                      start service.
                    </p>
                  </div>
                  <button className="subtleButton" onClick={() => load()}>
                    Refresh
                  </button>
                </div>
                <div className="tableLegend">
                  <span>
                    <i className="tableDot available" /> Available
                  </span>
                  <span>
                    <i className="tableDot occupied" /> Occupied
                  </span>
                  <span>
                    <i className="tableDot reserved" /> Reserved now
                  </span>
                </div>
                <div className="floorPlan">
                  {Array.from(
                    { length: Number(restaurant?.tableCount || 0) },
                    (_, i) => i + 1,
                  ).map((number) => {
                    const occupied = tables.occupied.find(
                      (table: any) => table.tableNumber === number,
                    );
                    const reserved = tables.reserved.find(
                      (table: any) => table.tableNumber === number,
                    );
                    const status = occupied
                      ? "occupied"
                      : reserved
                        ? "reserved"
                        : "available";
                    const reservedForLater =
                      reserved &&
                      new Date(reserved.startAt).getTime() > Date.now();
                    return (
                      <button
                        key={number}
                        className={`floorTable ${status}`}
                        disabled={!!reservedForLater}
                        onClick={() => selectTable(number)}
                      >
                        <span className="floorTableNumber">
                          {String(number).padStart(2, "0")}
                        </span>
                        <span className="floorTableStatus">
                          {occupied
                            ? "Occupied"
                            : reserved
                              ? reserved.customerName
                              : "Available"}
                        </span>
                        {occupied && (
                          <small>
                            Opened{" "}
                            {new Date(occupied.openedAt).toLocaleTimeString(
                              [],
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </small>
                        )}
                        {reserved && <small>{reserved.partySize} guests</small>}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {posSection === "food" && (
              <section className="workspace">
                <div className="pageHeading">
                  <div>
                    <p className="eyebrow">
                      {restaurant?.name || "RESTAURANT"}
                    </p>
                    <h1>
                      {selectedTable
                        ? `Table ${String(selectedTable).padStart(2, "0")}`
                        : "Order"}
                    </h1>
                    <p className="muted">
                      {selectedTable
                        ? "Choose dishes for this table."
                        : "Choose dishes to add them to this order."}
                    </p>
                  </div>
                  <span className="datePill">
                    <Clock3 size={15} /> Today
                  </span>
                </div>
                <div className="filterRow">
                  <div className="searchBox">
                    <Search size={17} />
                    <input
                      aria-label="Search dishes"
                      placeholder="Find a dish"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="chips">
                    {["All dishes", "Available"].map((c) => (
                      <button
                        className={category === c ? "selected" : ""}
                        onClick={() => setCategory(c)}
                        key={c}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                {dishes.length ? (
                  <div className="dishGrid">
                    {filtered
                      .filter((d) => d.available)
                      .map((d, i) => (
                        <button
                          className="dishCard"
                          onClick={() =>
                            setCart((x) => ({
                              ...x,
                              [d.id]: (x[d.id] || 0) + 1,
                            }))
                          }
                          key={d.id}
                          aria-label={`Add ${d.name} to order`}
                        >
                          <span className={`dishGlyph g${i % 4}`}>
                            <Utensils size={18} />
                          </span>
                          <span className="dishName">{d.name}</span>
                          <span className="dishDescription">
                            {d.description || "Available today"}
                          </span>
                          <span className="dishBottom">
                            <b>{money(d.priceMinor)}</b>
                            <span className="addMark">
                              <Plus size={16} />
                            </span>
                          </span>
                        </button>
                      ))}
                  </div>
                ) : (
                  <div className="empty">
                    <span className="emptyIcon">
                      <Utensils />
                    </span>
                    <h3>Your menu is ready for its first dish</h3>
                    <p>
                      No dishes are available for sale. Add dishes to the
                      restaurant menu before taking an order.
                    </p>
                  </div>
                )}
              </section>
            )}
            {posSection === "reservations" && (
              <section className="workspace">
                <div className="pageHeading">
                  <div>
                    <p className="eyebrow">TABLE BOOKINGS</p>
                    <h1>Reservations</h1>
                    <p className="muted">
                      Online bookings are confirmed automatically when a table
                      is available.
                    </p>
                  </div>
                  {restaurant?.published ? (
                    <a
                      className="subtleButton"
                      href={`/reserve/${restaurant.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open booking page
                    </a>
                  ) : (
                    <button
                      className="subtleButton"
                      onClick={() => go("settings")}
                    >
                      Enable online bookings
                    </button>
                  )}
                </div>
                <section className="posInfoPanel">
                  <div className="panelHeading">
                    <div>
                      <h2>Upcoming bookings</h2>
                      <p>{reservations.length} reservations</p>
                    </div>
                    <button className="subtleButton" onClick={() => load()}>
                      Refresh
                    </button>
                  </div>
                  {reservations.length ? (
                    reservations.map((booking) => (
                      <div className="tableRow onlineOrderRow" key={booking.id}>
                        <span>
                          <b>{booking.customerName}</b>
                          <small>
                            {booking.customerPhone} · {booking.partySize} guests
                          </small>
                        </span>
                        <span
                          className={`status ${booking.status === "SEATED" ? "paid" : "pending"}`}
                        >
                          {booking.status === "SEATED" ? "Seated" : "Confirmed"}
                        </span>
                        <b>
                          Table {String(booking.tableNumber).padStart(2, "0")}
                        </b>
                        <time>{restaurantDateTime(booking.startAt)}</time>
                        {booking.status === "CONFIRMED" &&
                          new Date(booking.startAt).getTime() <= Date.now() && (
                            <button
                              className="subtleButton"
                              onClick={() => selectTable(booking.tableNumber)}
                            >
                              Seat guests
                            </button>
                          )}
                      </div>
                    ))
                  ) : (
                    <div className="empty compact">
                      <CalendarDays />
                      <p>No reservations yet.</p>
                    </div>
                  )}
                </section>
              </section>
            )}
            {posSection === "settings" && (
              <section className="workspace">
                <div className="pageHeading">
                  <div>
                    <p className="eyebrow">POINT OF SALE</p>
                    <h1>Settings</h1>
                    <p className="muted">Current settings used by this POS.</p>
                  </div>
                </div>
                <section className="posInfoPanel">
                  <div className="settingRow">
                    <span>Restaurant</span>
                    <b>{restaurant?.name || "—"}</b>
                  </div>
                  <div className="settingRow">
                    <span>Currency</span>
                    <b>{currency}</b>
                  </div>
                  <div className="settingRow">
                    <span>Business timezone</span>
                    <b>{timezone}</b>
                  </div>
                  <div className="settingRow">
                    <span>Payment method</span>
                    <b>Cash · staff confirmed</b>
                  </div>
                  <p className="hint">
                    Cash payments require staff confirmation after receiving the
                    money. No terminal is required.
                  </p>
                </section>
              </section>
            )}
            {posSection === "storage" && (
              <section className="workspace">
                <div className="pageHeading">
                  <div>
                    <p className="eyebrow">STORAGE</p>
                    <h1>Availability</h1>
                    <p className="muted">
                      Dish availability from the restaurant menu.
                    </p>
                  </div>
                </div>
                <section className="posInfoPanel">
                  <div className="panelHeading">
                    <div>
                      <h2>Menu item availability</h2>
                      <p>
                        {dishes.filter((d) => d.available).length} available ·{" "}
                        {dishes.filter((d) => !d.available).length} unavailable
                      </p>
                    </div>
                  </div>
                  {dishes.length ? (
                    dishes.map((d) => (
                      <div className="tableRow" key={d.id}>
                        <span>
                          <b>{d.name}</b>
                          <small>{d.description || "Menu item"}</small>
                        </span>
                        <span
                          className={`status ${d.available ? "paid" : "pending"}`}
                        >
                          {d.available ? "Available" : "Unavailable"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="empty compact">
                      <Boxes />
                      <p>No dishes in the restaurant menu yet.</p>
                    </div>
                  )}
                  <p className="hint">
                    Ingredient stock counts are not tracked yet; this view
                    reflects menu availability only.
                  </p>
                </section>
              </section>
            )}
            {posSection === "food" && (
              <aside
                className={`orderPanel ${mobileCart ? "mobileOpen" : ""}`}
              >
                <div className="orderHead">
                  <div>
                    <p className="eyebrow">
                      {selectedTable ? "TABLE ORDER" : "ORDER SUMMARY"}
                    </p>
                    <h2>
                      {selectedTable
                        ? `Table ${String(selectedTable).padStart(2, "0")}`
                        : "Order"}
                    </h2>
                  </div>
                  <div className="orderActions">
                    <button
                      className="iconButton"
                      onClick={() => setCart({})}
                      aria-label="Clear order"
                    >
                      <Receipt size={18} />
                    </button>
                    <button
                      className="cartCloseButton"
                      onClick={() => setMobileCart(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
                {picked.length ? (
                  <div className="orderLines">
                    {picked.map((d) => (
                      <div className="orderLine" key={d.id}>
                        <div className="lineInfo">
                          <b>{d.name}</b>
                          <span>{money(d.priceMinor)} each</span>
                        </div>
                        <div className="quantity">
                          <button
                            aria-label={`Remove one ${d.name}`}
                            onClick={() =>
                              setCart((x) => ({
                                ...x,
                                [d.id]: Math.max(0, x[d.id] - 1),
                              }))
                            }
                          >
                            <Minus size={14} />
                          </button>
                          <span>{cart[d.id]}</span>
                          <button
                            aria-label={`Add one ${d.name}`}
                            onClick={() =>
                              setCart((x) => ({ ...x, [d.id]: x[d.id] + 1 }))
                            }
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <b className="lineTotal">
                          {money(d.priceMinor * cart[d.id])}
                        </b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="cartEmpty">
                    <span className="cartIcon">
                      <ShoppingBag />
                    </span>
                    <b>No items yet</b>
                    <span>Select food from the menu.</span>
                  </div>
                )}
                <div className="orderFoot">
                  <div className="totalLine">
                    <span>Subtotal</span>
                    <span>{money(total)}</span>
                  </div>
                  <div className="totalLine">
                    <span>Tax</span>
                    <span>—</span>
                  </div>
                  <div className="grandTotal">
                    <span>Total</span>
                    <b>{money(total)}</b>
                  </div>
                  <button
                    className="primary full"
                    disabled={!picked.length}
                    onClick={() => go("checkout")}
                  >
                    Payment <ArrowRight size={17} />
                  </button>
                  <p className="hint">Checkout opens as a separate page.</p>
                </div>
              </aside>
            )}
            {posSection === "food" && (
              <button
                className="mobileCartButton"
                onClick={() => setMobileCart(!mobileCart)}
              >
                <ShoppingBag size={17} />
                {mobileCart ? "Hide order" : `Order · ${money(total)}`}
                {picked.length > 0 && (
                  <span>{picked.reduce((n, d) => n + cart[d.id], 0)}</span>
                )}
              </button>
            )}
          </div>
        )}
        {page === "dashboard" && (
          <div className="contentPage">
            <div className="pageHeading">
              <div>
                <p className="eyebrow">RESTAURANT BUSINESS</p>
                <h1>{restaurant?.name || "Dashboard"}</h1>
                <p className="muted">
                  Revenue overview across orders recorded for this restaurant.
                </p>
              </div>
              <button className="subtleButton" onClick={() => load()}>
                Refresh
              </button>
            </div>
            <div className="statsGrid revenuePeriods">
              <article className="statCard">
                <span>Today</span>
                <b>{money(revenue?.dayMinor || 0)}</b>
                <small>{revenue?.dayOrders || 0} paid sales</small>
              </article>
              <article className="statCard">
                <span>This month</span>
                <b>{money(revenue?.monthMinor || 0)}</b>
                <small>{revenue?.monthOrders || 0} paid sales</small>
              </article>
              <article className="statCard">
                <span>This year</span>
                <b>{money(revenue?.yearMinor || 0)}</b>
                <small>{revenue?.yearOrders || 0} paid sales</small>
              </article>
            </div>
            <section className="panel addPanel">
              <div>
                <h2>Record a cash sale</h2>
                <p>
                  Use this when the restaurant does not use the POS at the
                  counter.
                </p>
              </div>
              <form
                className="addForm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(`/api/orders/${restaurant.id}/manual-sale`, {
                      method: "POST",
                      body: JSON.stringify({
                        amountMinor: Math.round(
                          Number(form.saleAmount) * minorFactor,
                        ),
                        note: form.saleNote,
                      }),
                    });
                    setField("saleAmount", "");
                    setField("saleNote", "");
                    await load();
                  } catch (x: any) {
                    setNotice(x.message);
                  }
                }}
              >
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Sale amount"
                  value={form.saleAmount || ""}
                  onChange={(e) => setField("saleAmount", e.target.value)}
                />
                <input
                  placeholder="Note (optional)"
                  value={form.saleNote || ""}
                  onChange={(e) => setField("saleNote", e.target.value)}
                />
                <button className="primary">Record sale</button>
              </form>
            </section>
            <section className="panel">
              <div className="panelHeading">
                <div>
                  <h2>Recent sales and orders</h2>
                  <p>Paid sales contribute to the revenue totals above.</p>
                </div>
              </div>
              {orders.length ? (
                orders.slice(0, 8).map((o) => (
                  <div className="tableRow" key={o.id}>
                    <span>
                      <b>{o.customerName}</b>
                      <small>
                        {new Date(o.createdAt).toLocaleString(undefined, {
                          timeZone: timezone,
                        })}
                      </small>
                    </span>
                    <span
                      className={`status ${o.status === "PAID" ? "paid" : "pending"}`}
                    >
                      {o.status === "PAID" ? "Paid" : "Awaiting payment"}
                    </span>
                    <b>{money(o.totalMinor)}</b>
                  </div>
                ))
              ) : (
                <div className="empty compact">
                  <Receipt />
                  <p>No sales recorded yet.</p>
                </div>
              )}
            </section>
          </div>
        )}
        {(page === "menu" || page === "inventory") && (
          <div className="contentPage">
            <div className="pageHeading">
              <div>
                <p className="eyebrow">CATALOG</p>
                <h1>{page === "menu" ? "Menu" : "Availability & stock"}</h1>
                <p className="muted">
                  Manage the dishes customers and staff can order.
                </p>
              </div>
              {restaurant?.slug && (
                <button className="subtleButton" onClick={togglePublish}>
                  {restaurant.published
                    ? "Pause online reservations"
                    : "Enable online reservations"}
                </button>
              )}
            </div>
            <div className="panel addPanel">
              <div>
                <h2>Add a dish</h2>
                <p>
                  Prices use the selected currency’s standard fraction digits.
                </p>
              </div>
              <form className="addForm" onSubmit={addDish}>
                <input
                  required
                  placeholder="Dish name"
                  value={form.dishName || ""}
                  onChange={(e) => setField("dishName", e.target.value)}
                />
                <input
                  placeholder="Short description"
                  value={form.description || ""}
                  onChange={(e) => setField("description", e.target.value)}
                />
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Price"
                  value={form.price || ""}
                  onChange={(e) => setField("price", e.target.value)}
                />
                <button className="primary">
                  <Plus size={16} /> Add dish
                </button>
              </form>
            </div>
            <div className="panel">
              <div className="panelHeading">
                <div>
                  <h2>Current menu</h2>
                  <p>{dishes.length} items</p>
                </div>
              </div>
              {dishes.length ? (
                <div className="tableScroll">
                  <table className="menuTable">
                    <thead>
                      <tr>
                        <th>Dish</th>
                        <th>Description</th>
                        <th>Price</th>
                        <th>Availability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dishes.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <b>{d.name}</b>
                          </td>
                          <td>{d.description || "—"}</td>
                          <td>{money(d.priceMinor)}</td>
                          <td>
                            <button
                              className={`statusToggle ${d.available ? "isAvailable" : ""}`}
                              onClick={async () => {
                                try {
                                  await api(
                                    `/api/catalog/restaurants/${restaurant.id}/dishes/${d.id}`,
                                    {
                                      method: "PATCH",
                                      body: JSON.stringify({
                                        available: !d.available,
                                      }),
                                    },
                                  );
                                  load();
                                } catch (e: any) {
                                  setNotice(e.message);
                                }
                              }}
                            >
                              {d.available ? "Available" : "Unavailable"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty compact">
                  <Utensils />
                  <p>Nothing here yet. Add your first dish above.</p>
                </div>
              )}
            </div>
          </div>
        )}
        {page === "settings" && (
          <div className="contentPage">
            <div className="pageHeading">
              <div>
                <p className="eyebrow">TABLE RESERVATIONS</p>
                <h1>Reservation settings</h1>
                <p className="muted">
                  Set table capacity and the hours available for online
                  bookings.
                </p>
              </div>
            </div>
            <div className="panel settingsPanel">
              <h2>{restaurant?.name}</h2>
              <div className="settingRow">
                <span>Accept online reservations</span>
                <button
                  className={`statusToggle ${restaurant?.published ? "isAvailable" : ""}`}
                  onClick={togglePublish}
                >
                  {restaurant?.published ? "Enabled" : "Disabled"}
                </button>
              </div>
              {restaurant?.slug && (
                <div className="settingRow">
                  <span>Public reservation link</span>
                  <a
                    href={`/reserve/${restaurant.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {location.origin}/reserve/{restaurant.slug}
                  </a>
                </div>
              )}
              <p className="hint">
                When enabled, guests can book one table per one-hour time slot.
              </p>
            </div>
            <form
              className="panel reservationSettingsForm"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const updated = await api(
                    `/api/catalog/restaurants/${restaurant.id}/settings`,
                    {
                      method: "PATCH",
                      body: JSON.stringify({
                        tableCount: Number(
                          form.tableCount ?? restaurant.tableCount,
                        ),
                        openingTime: form.openingTime || restaurant.openingTime,
                        closingTime: form.closingTime || restaurant.closingTime,
                      }),
                    },
                  );
                  setRestaurant({ ...restaurant, ...updated });
                  setField("tableCount", String(updated.tableCount));
                  setField("openingTime", updated.openingTime);
                  setField("closingTime", updated.closingTime);
                  setNotice("Reservation settings saved");
                } catch (e: any) {
                  setNotice(e.message);
                }
              }}
            >
              <div>
                <h2>Tables and opening hours</h2>
                <p>Online bookings use one-hour slots during these hours.</p>
              </div>
              <div className="reservationSettingsFields">
                <label>
                  Total tables
                  <input
                    type="number"
                    min="1"
                    max="200"
                    required
                    value={form.tableCount ?? restaurant?.tableCount ?? 10}
                    onChange={(e) => setField("tableCount", e.target.value)}
                  />
                </label>
                <label>
                  Opens
                  <select
                    value={
                      form.openingTime ?? restaurant?.openingTime ?? "11:00"
                    }
                    onChange={(e) => setField("openingTime", e.target.value)}
                  >
                    {Array.from(
                      { length: 24 },
                      (_, i) => `${String(i).padStart(2, "0")}:00`,
                    ).map((time) => (
                      <option key={time}>{time}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Closes
                  <select
                    value={
                      form.closingTime ?? restaurant?.closingTime ?? "22:00"
                    }
                    onChange={(e) => setField("closingTime", e.target.value)}
                  >
                    {Array.from(
                      { length: 24 },
                      (_, i) => `${String(i).padStart(2, "0")}:00`,
                    ).map((time) => (
                      <option key={time}>{time}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="primary">Save reservation settings</button>
            </form>
          </div>
        )}
        {page === "promotions" && (
          <div className="contentPage">
            <div className="pageHeading">
              <div>
                <p className="eyebrow">CUSTOMER MESSAGES</p>
                <h1>Promotions</h1>
                <p className="muted">
                  Send offers by email or SMS to customers who opted in at
                  checkout.
                </p>
              </div>
            </div>
            <section className="panel addPanel">
              <div>
                <h2>New promotion</h2>
                <p>
                  Provider credentials are configured by the system operator.
                </p>
              </div>
              <form
                className="campaignForm"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(`/api/orders/${restaurant.id}/promotions`, {
                      method: "POST",
                      body: JSON.stringify({
                        channel: form.channel || "EMAIL",
                        title: form.promoTitle,
                        message: form.promoMessage,
                      }),
                    });
                    setField("promoTitle", "");
                    setField("promoMessage", "");
                    setCampaigns(
                      await api(`/api/orders/${restaurant.id}/promotions`),
                    );
                    setNotice("Promotion submitted to opted-in customers");
                  } catch (x: any) {
                    setNotice(x.message);
                  }
                }}
              >
                <select
                  value={form.channel || "EMAIL"}
                  onChange={(e) => setField("channel", e.target.value)}
                >
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                </select>
                <input
                  required
                  placeholder="Promotion title"
                  value={form.promoTitle || ""}
                  onChange={(e) => setField("promoTitle", e.target.value)}
                />
                <textarea
                  required
                  maxLength={1000}
                  placeholder="Write your offer"
                  value={form.promoMessage || ""}
                  onChange={(e) => setField("promoMessage", e.target.value)}
                />
                <button className="primary">Send promotion</button>
              </form>
            </section>
            <section className="panel">
              <div className="panelHeading">
                <div>
                  <h2>Campaign history</h2>
                  <p>
                    Delivery counts are reported by the configured provider
                    response.
                  </p>
                </div>
              </div>
              {campaigns.length ? (
                campaigns.map((c) => (
                  <div className="tableRow" key={c.id}>
                    <span>
                      <b>{c.title}</b>
                      <small>
                        {c.channel} · {new Date(c.createdAt).toLocaleString()}
                      </small>
                    </span>
                    <span
                      className={`status ${c.status === "SENT" ? "paid" : "pending"}`}
                    >
                      {c.status}
                    </span>
                    <span>
                      {c.recipientCount} delivered · {c.failedCount} failed
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty compact">
                  <Receipt />
                  <p>No promotions sent yet.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
