# CKSC Online Souvenir

CKSC Online Souvenir is the official Quasar/Vue 3 storefront for the Taipei Municipal Chien Kuo High School Student Council's souvenir campaign.

The application allows visitors to browse merchandise, place orders, and track their orders. Authorized managers and administrators can review orders, update payment and delivery status, and send customer notifications.

## Highlights

- Product catalog with size-based variants for jackets, shorts, caps, and other merchandise
- Shopping cart and checkout flow for customer orders
- Order lookup and order history pages for buyers
- Role-based administration for managers, admins, and super admins
- Firebase-backed authentication, Firestore data storage, Firebase Storage, and Analytics
- Automated order confirmation emails and bulk notification emails through Cloud Functions
- Launch gate that redirects visitors to `/comingsoon` before the sale opens

## Tech Stack

### Frontend

- Vue 3
- Quasar 2
- Vue Router
- Pinia

### Backend & Services

- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase Analytics
- Firebase Hosting
- Firebase Cloud Functions
- AWS SES for email delivery

### Utility Libraries

- xlsx
- file-saver
- html2pdf.js
- qrcode

## Project Structure

```text
src/
├── pages/                 # Route-level screens such as Home, Cart, Orders, Admin, and Account
├── components/            # Reusable product and UI components
├── stores/                # Pinia stores for auth, cart, toast state, and related app state
├── services/              # Order persistence and admin-order helpers
├── data/                  # Product catalog and pricing data
└── router/                # Route definitions and navigation guards

functions/                 # Firebase Cloud Functions for email and notification workflows
public/                    # Static assets
.github/workflows/
└── deploy.yml             # GitHub Pages deployment workflow
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

### 1. Build Image

```bash
docker build -t my-souvenir-app .
```

### 2. Run Container

```bash
docker run -p 9000:9000 my-souvenir-app
```

This launches the Quasar/Vite development server.

## Production Build

Create a production build with:

```bash
docker run --rm -p 9000:9000 my-souvenir-app npm run build
```

The generated SPA files are written to:

```text
dist/spa
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
    "default": "cksc-merchandis"
  }
}
```

Before running Firebase commands, authenticate and select the appropriate project:

```bash
firebase login
firebase use <your-project>
```

## Cloud Functions & Email

The Cloud Functions in:

```text
functions/index.js
```

expect the following runtime values or secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `SENDER_EMAIL`

If email delivery is not required during local frontend development, these values are not required for the frontend itself. However, Cloud Functions that depend on them will fail if they are invoked without the required configuration.

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
| `/product/:id` | Product detail page |
| `/cart` | Shopping cart and checkout |
| `/orders` | Buyer order history |
| `/orders/:id` | Order detail |
| `/admin` | Admin dashboard |
| `/admin/login` | Admin login |
| `/comingsoon` | Pre-launch landing page |

## Application Notes

### Launch Gate

The storefront launch gate is enforced in:

```text
src/router/index.js
```

Before the configured launch date, visitors are redirected to `/comingsoon`. Authorized manager and administrator accounts can bypass this restriction.

### Mock Orders

Mock order mode is available in:

```text
src/config/app.js
```

It is disabled by default.

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

**CKSC Online Souvenir**  
Taipei Municipal Chien Kuo High School Student Council
