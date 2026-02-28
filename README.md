# BatchMaker — Professional Bakery & Kitchen Production Management

BatchMaker is a comprehensive production management system designed for commercial bakeries, restaurants, and food production facilities. It combines workflow automation, batch tracking, timer management, team coordination, inventory management, and financial reporting into a single platform — with a native mobile app and a full web dashboard.

---

## 🎯 Core Features

### 1. Workflow Management
Create, organize, and execute production workflows with precision timing and ingredient tracking.

- **Custom Workflow Builder** — step-by-step instructions with timers, checklists, and ingredient tracking
- **AI Recipe Parser** — import recipes from text or URLs using Claude AI
  - Automatic ingredient extraction and scaling
  - Smart step detection and timer assignment
  - URL caching (popular recipes cached for instant re-import)
- **Workflow Editor** — full WYSIWYG editing of existing workflows
- **Archive System** — archive/unarchive without deletion
- **Checklist Items** — ingredient checklists per step for quality control
- **YouTube Integration** — embed reference videos for training
- **Batch Scaling** — multiply recipes by 0.5×, 1×, 2×, 3×, or custom amounts

### 2. Batch Tracking & Execution
Real-time tracking of production batches with multi-station support.

- **Bake Today Mode** 🟢 — immediate production workflow
- **Cold Ferment Mode** 🔵 — multi-day production with overnight rest
- **Batch Claiming** — station-based ownership; see which station owns which batch
- **Progress Tracking** — visual completion status per step
- **Batch Duplication** — clone batches with all settings
- **Long-Press Menus** — quick actions (rename, duplicate, claim, delete)

### 3. Timer System
Production-grade timer management with visual alerts.

- **Multiple Active Timers** — track multiple steps simultaneously
- **Urgent Timer Display** — shows most critical timer across all active batches
- **Expiration Alerts** — flashing red borders when timers expire
- **Background Persistence** — timers continue when app is closed

### 4. Multi-User Team Coordination

- **Station Names** — each device sets a custom station name
- **Workflow Claiming** — claim workflows to prevent conflicts
- **Real-Time Sync** — changes sync across all stations via Supabase
- **Employee Directory** — manage staff with Active / On Leave / Terminated status
- **Clock-In / Clock-Out** — time tracking tied to locations
- **Employment Status Gate** — `canClockIn()` blocks terminated/on-leave staff
- **Network Invites** — invite employees via email (Resend integration)

### 5. Scheduling & Labour

- **Shift Management** — create and assign shifts (Scheduled / Holiday / Sick)
- **Schedule Templates** — save and reuse weekly templates
- **Labour Cost Report** — per-employee hours, hourly rate, and total cost
- **Holiday Request Workflow** — staff submit in app; managers approve/decline on web
- **Printable Export** — print-ready schedule view

### 6. Reports & Quality Control

#### App — Reports Screen
- **Two-tab layout**: 📅 Day Reports and 🧺 Batches
- **Start of Day Report** — records ambient temp, humidity, fridge, freezer, proof box, and oven temperatures
- **End of Day Report** — summarises batches, workflow breakdown, avg duration, labour summary, and inventory par snapshot
- **Smart Generate Modal** — detects whether SoD is done and whether a workday is active
- **Tap-to-open** — every report opens a full detail modal with edit capability
- **Inventory par snapshot** — below-par items highlighted in EoD report

#### Web Dashboard — Analytics
- Waste analytics with waste-by-workflow and waste-by-step breakdowns
- Batch reports viewer — searchable, filterable, expandable rows, CSV export
- Revenue, cost, and profit metrics (30-day + all-time)

### 7. Inventory Management
Full inventory system supporting invoice scanning, supplier management, par levels, and location transfers.

#### Invoice / Packing Slip Scanner (App)
- Tap **Scan Invoice** from inventory screen (requires active clock-in)
- Google Vision OCR extracts text from photo
- Claude AI parses into structured line items with locked category matching
- Review and edit results before confirming
- Saves invoice + line items; updates location stock automatically
- Backorder support: only received quantities update stock

#### Supplier Management (Web Dashboard)
Four-tab interface:

| Tab | Features |
|-----|----------|
| 📦 **Items** | Item list, quantity vs par level, low stock badges, add/edit/delete, category filter |
| 🧾 **Invoices** | All invoices, expandable line items, mark paid/unpaid, financial summary |
| 🏭 **Suppliers** | Supplier directory, invoice history, spend totals, add/edit/delete |
| 🔄 **Transfers** | Log and view location-to-location stock movements |

#### Par Levels & Low Stock Alerts
- Set par levels per item via the Items tab
- Alerts surface in dashboard overview, inventory badges, and EoD reports
- Full inventory snapshot attached to every End of Day report

### 8. Web Dashboard
Full management interface:

| Section | Purpose |
|---------|---------|
| Overview | KPIs, alerts, quick actions, location comparisons |
| Workflows | Manage all recipes and workflows |
| Calendar | Schedule batches, repeat recurring, force-close stuck |
| Inventory | Suppliers, invoices, par levels, transfers |
| Analytics | Waste, revenue, cost, profit metrics |
| Schedule | Shifts, labour reports, holiday requests |
| Settings | Location, currency, timezone, account tier |

---

## 🏗️ Technical Stack

### Mobile App
- **React Native + Expo Router** — cross-platform iOS + Android
- **TypeScript** — type-safe throughout
- **AsyncStorage** — local cache with Supabase sync
- **Expo Camera** — invoice scanning
- **Expo FileSystem + Sharing** — CSV/JSON export

### Web Dashboard
- **Next.js + TypeScript** — React-based web app
- **Tailwind CSS** — utility-first styling
- **Supabase JS** — real-time data + auth

### Backend
- **Supabase** — PostgreSQL + Auth + Storage + Realtime
- **Next.js API Routes** — server-side endpoints
- **Supabase Edge Functions** — AI parsing functions
- **Row-Level Security** — database-level auth on every table
- **Resend** — transactional email

### AI Integration
- **Claude Sonnet** — invoice/packing slip parsing
- **Claude Haiku** — recipe parsing
- **Google Vision API** — OCR for invoice scanning
- Rate limiting: 5 parses/hr, 15/day per user; cached URLs don't count

### Database Schema
```
Core:
  profiles             — user metadata, device names, tiers
  workflows            — recipes with steps
  batches              — active production runs
  locations            — registered locations, GPS coords, currency

Team:
  network_member_roles — employee roles, hourly rates, status, location assignments
  time_entries         — clock-in / clock-out records
  shifts               — scheduled shifts
  holiday_requests     — leave requests + approval status

Reports:
  reports                   — daily EoD reports (JSONB data column)
  batch_completion_reports  — individual batch completions
  environmental_reports     — Start of Day reports (temps, humidity, equipment)

Inventory:
  suppliers            — supplier directory
  inventory_items      — owner-scoped item catalogue with par levels
  location_inventory   — per-location quantities (unique on location+item)
  invoices             — scanned packing slips / invoices
  invoice_line_items   — line items per invoice
  inventory_transfers  — location-to-location stock movements

AI / Caching:
  recipe_parse_logs   — usage tracking
  url_parse_cache     — cached AI parses
```

---

## 📱 Platforms

| Platform | Status |
|----------|--------|
| iOS | In development (Expo) |
| Android | In development (Expo) |
| Web Dashboard | Live (Next.js) |
| Desktop | Future (Electron wrapper) |

---

## 🔒 Authentication & Security

- Email/password + magic link authentication
- JWT-based API auth on all endpoints
- Row-Level Security on every database table
- Clock-in enforcement at API level for inventory writes
- Employment status gate for all clock-in flows

---

## 🚀 Getting Started

### Prerequisites
```bash
Node.js 18+
Expo CLI
Supabase account
Anthropic API key
Google Vision API key
Resend API key
```

### Mobile App
```bash
cd batch-maker-app
npm install
# Set in app.config.ts:
# EXPO_PUBLIC_SUPABASE_URL
# EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start
```

### Web Dashboard
```bash
cd batch-maker-website
npm install
# .env.local:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE_KEY
# ANTHROPIC_API_KEY
# GOOGLE_VISION_API_KEY
# RESEND_API_KEY
npm run dev
```

### Database Setup
1. Run all migrations in `supabase/migrations/` in order
2. Run `migration_inventory.sql` for the inventory system
3. Run equipment temps migration:
   ```sql
   ALTER TABLE environmental_reports
     ADD COLUMN IF NOT EXISTS fridge_temp numeric,
     ADD COLUMN IF NOT EXISTS freezer_temp numeric,
     ADD COLUMN IF NOT EXISTS proof_temp numeric,
     ADD COLUMN IF NOT EXISTS oven_temp numeric;
   ```
4. Create Supabase Storage bucket `order-scans` with owner-scoped RLS

### Deploy Edge Functions
```bash
supabase functions deploy parse-recipe
supabase functions deploy parse-recipe-url
```

---

## 📊 Usage Limits

| | Standard | Premium |
|---|---|---|
| Workflows | Unlimited | Unlimited |
| Batches | Unlimited | Unlimited |
| Inventory items | Unlimited | Unlimited |
| AI recipe parses | 5/hr · 15/day | Unlimited |
| Cached URL parses | Don't count | Don't count |
| POS integration | — | ✓ |
| Advanced analytics | — | ✓ |

---

## 🗺️ Roadmap

### Pre-Launch
- [ ] New user tutorial / onboarding
- [ ] Location locking (GPS clock-in validation)
- [ ] Drag-to-reorder workflows
- [ ] App Store + Play Store submission

### Post-Launch
- [ ] POS integration (Square → Lightspeed → Clover)
- [ ] Predictive batch scheduling (sales trends × par levels)
- [ ] Inventory analytics (price trends, spend by supplier/category)
- [ ] QR code batch labels
- [ ] Public recipe directory
- [ ] Google Calendar sync + QuickBooks integration

### Enterprise / Future
- [ ] Role-based permissions (Manager / Supervisor / Operator)
- [ ] Customer order tracking
- [ ] Equipment maintenance logs
- [ ] Language packs

---

## 🐛 Known Issues

- Timer push notifications (background) require native module configuration
- Excel import requires a specific column format
- Some recipe websites block scraping

---

## 📄 License

Proprietary — All Rights Reserved

---

**Built for bakers, by bakers.** 🥖