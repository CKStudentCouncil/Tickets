# Firebase Cloud Functions - Email & QR Code

This directory contains Cloud Functions that handle automatic QR code generation and email sending when orders are created.

## Setup Instructions

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Create Environment File

Create a `.env.local` file in the `functions/` directory:

```bash
# Windows (PowerShell)
@'
GMAIL_EMAIL=cksc.noreply@gmail.com
GMAIL_PASSWORD=xrsy kxqr josn syvn
'@ | Out-File -Encoding UTF8 functions\.env.local

# macOS/Linux
echo 'GMAIL_EMAIL=cksc.noreply@gmail.com
GMAIL_PASSWORD=xrsy kxqr josn syvn' > functions/.env.local
```

Or create the file manually:
- Create file: `functions/.env.local`
- Add content:
  ```
  GMAIL_EMAIL=cksc.noreply@gmail.com
  GMAIL_PASSWORD=xrsy kxqr josn syvn
  ```

### 3. Set Gmail App Password

Follow these steps if you haven't already:

1. **Enable 2-Factor Authentication** on your Gmail account:
   - Go to https://myaccount.google.com/security
   - Enable 2-Step Verification

2. **Generate an App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer"
   - Copy the generated 16-character password

3. **Update `.env.local`**:
   - Replace `GMAIL_EMAIL` with your Gmail address
   - Replace `GMAIL_PASSWORD` with your 16-character app password

### 4. Test Locally

```bash
npm run serve
```

This will start the Firebase Emulator Suite. Create a test order in Firestore to see if the email is sent.

### 5. Deploy to Production

When deploying, use the new params system:

```bash
firebase deploy --only functions
```

Firebase will prompt you to enter the parameter values. Provide:
- `GMAIL_EMAIL`: your Gmail address
- `GMAIL_PASSWORD`: your app password

Or define them in the Firebase Console:
1. Go to Firebase Console → Functions → Runtime Configuration
2. Add the parameters there

## How It Works

When a new order is created in Firestore (`orders` collection):

1. **QR Code Generation**: A QR code is generated linking to `https://cksc-souvenir.web.app/orders/{orderId}`

2. **Email Sending**: Two emails are sent:
   - **To**: Customer email (from the order)
   - **CC**: ckhssc@gl.ck.tp.edu.tw (school email)

3. **Email Content**:
   - Order confirmation details
   - Product list
   - QR code (as inline image)
   - Links to view the full order

## Email Recipients

- **Customer**: Gets the QR code and can track their order
- **School Admin** (ckhssc@gl.ck.tp.edu.tw): Gets a copy for their records

## Troubleshooting

### Email not sending?

1. Check Cloud Functions logs:
   ```bash
   npm run logs
   ```

2. Verify `.env.local` file exists and has correct values

3. Ensure Gmail 2FA and App Password are correctly configured

4. Check that the `orders` collection exists in Firestore

### Function not triggering?

- Verify the order URL is correctly formed
- Check email client supports embedded images (most do)
- The QR code links to the order detail page

## Security Notes

- `.env.local` is in `.gitignore` - never commit it
- App passwords are stored securely in `.env.local` (local) and Firebase Params (production)
- Use different email accounts for development and production if needed
- Monitor email sending costs (Gmail has limits)

## New Params System

This project uses the new Firebase Cloud Functions `params` API (as of v5.0.0) which replaces the deprecated `functions.config()` API.

