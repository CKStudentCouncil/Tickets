# CK Party Night Tickets

CK Tickets is the official Quasar/Vue 3 ticketing site for CK Party Night, run by the Taipei Municipal Chien Kuo High School Student Council.

Visitors buy tickets without an account and can look their orders up again on the same device. Invited staff (managers, admins and super admins) sign in with Google to check tickets in, manage orders, send notifications and edit site content.

## Highlights

- Ticket types (price, sale window, eligibility, stock, per-person limit) configured in the admin UI
- Server-side order validation in a Cloud Function transaction, so tickets cannot be oversold
- Confirmation email with a QR code that door staff scan into the admin order view
- Role-based administration for managers, admins, and super admins
- Bulk payment / pickup notification emails through AWS SES
- Party introduction, lineup pages and a user survey managed from the admin UI
- Launch gate that redirects visitors to `/comingsoon` before the sale opens

## Tech Stack

- Vue 3, Quasar 2, Vue Router, Pinia
- Firebase Authentication, Cloud Firestore, Cloud Storage, Cloud Functions, Hosting, Analytics
- AWS SES for email delivery
- exceljs, file-saver, html2pdf.js, qrcode

## Project Structure

```text
src/
├── pages/          # Route-level screens
├── layouts/        # MainLayout (header, navigation, footer)
├── components/     # AppToast
├── composables/    # useAdminOrders (admin order list, stats, Excel export)
├── services/       # orderService, ticketTypeService (all Firestore / callable access)
├── stores/         # auth (user + role), toast
├── data/           # schools, survey questions
├── utils/          # datetime, text, qrcode, pdf, analytics, guestOrders, debounce
├── config/         # launch date
└── router/         # routes and navigation guard

functions/          # Cloud Functions, see functions/README.md
firestore.rules     # Firestore security rules
public/             # Static assets (logo, GitHub Pages 404 redirect)
```

## Requirements

- Node.js 18, 20, 22, or 24
- npm or yarn
- Firebase CLI for Firebase deployment
<!--
## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Development Server

```bash
npm run dev
```

This launches the Quasar/Vite development server.

## Production Build

Create a production build with:

```bash
npm run build
```
-->
## Local Development With Docker

The Docker image runs the Quasar **dev server** for local development only; production is the static build in `dist/spa` served by Firebase Hosting / GitHub Pages.

### 1. Build Image

```bash
docker build -t cksc-tickets .
```

### 2. Run Container

```bash
docker run -p 9000:9000 cksc-tickets
```

This launches the Quasar/Vite development server.

## Production Build

Create a production build with:

```bash
docker run --rm -p 9000:9000 cksc-tickets npm run build
```

The generated SPA files are written to:

```text
dist/spa
```


## Tests

```bash
cd functions && npm test          # order validation, time handling, SES mailer (no emulator needed)
npm run test:rules                # Firestore rules, needs Java for the emulator
cd functions && npm run test:emulator   # createOrder transaction / oversell test, needs Java
```

## Firebase Configuration

The application is configured to use Firebase through:

```text
src/boot/firebase.js
```

If you are using a different Firebase project, update the Firebase configuration and make sure the correct project alias is configured in:

```text
.firebaserc
```

Example:

```json
{
  "projects": {
    "default": "cksc-ticket"
  }
}
```

Before running Firebase commands, authenticate and select the appropriate project:

```bash
firebase login
firebase use <your-project>
```

## Cloud Functions & Email

See [functions/README.md](functions/README.md) for the function list and the AWS SES secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) they need. Ordering does not work without the functions deployed.

## Ticket Eligibility and Purchase Limits

All checks run on the server (`functions/lib/orderValidation.js`), but buyers do not sign in, so two of them rely on what the buyer declares:

- **Campus-only tickets** are sold to anyone who picks one of the six campus schools. The server cannot verify that the buyer is a student.
- **Per-person limits** are counted per email address (`buyerPurchases/{sha256(email)}`). A buyer who uses a second email can buy again.

Until buyers are required to sign in (for example with a school Google account), these limits must be enforced at the door by checking student IDs, and the sales policy should say so.

## Staff Accounts

A super admin invites staff on `/admin/account` (stored as `pendingUsers/{email}`). The invited person then signs in with Google on `/admin/login` using that email, which activates the account with the invited role.

## Deployment

### GitHub Pages

The frontend is published through:

```text
.github/workflows/deploy.yml
```

The workflow installs dependencies, builds the Quasar application, and publishes the generated files from:

```text
dist/spa
```

### Firebase

To deploy the Firebase project and configured services:

```bash
firebase deploy
```

## Main Routes

| Route | Description |
|---|---|
| `/` | Storefront home |
| `/product/:id` | Ticket type detail and order form |
| `/order-success` | Order confirmation |
| `/orders` | Buyer order history (this device) |
| `/orders/:id` | Order detail |
| `/intro`, `/performer`, `/about` | Party introduction, lineup, about |
| `/survey` | User survey |
| `/admin` | Admin dashboard / notifications |
| `/admin/orders/:id` | Staff order view (ticket QR codes link here) |
| `/admin/management` | Ticket type settings |
| `/admin/account` | Staff accounts |
| `/admin/login` | Staff login |
| `/comingsoon` | Pre-launch landing page |

## Application Notes

### Launch Gate

The storefront launch gate is enforced in:

```text
src/router/index.js
```

Before `SHOP_OPEN_AT` in `src/config/app.js`, visitors are redirected to `/comingsoon`. Staff accounts can bypass this restriction.

## Maintainers

This project is maintained by the **Taipei Municipal Chien Kuo High School Student Council**.

## Developers

### Chris Sun

- 79-2 Student Council Student Assembly Deputy Speaker
- 80-1 Student Council Chairman (President)
- 80-2 Student Council Speaker

### Jim Tang

- 80-1 Student Council Executive Department CIO
- 80-2 Student Council Executive Department IT Associate

---

**CK Party Night Tickets**  
Taipei Municipal Chien Kuo High School Student Council
