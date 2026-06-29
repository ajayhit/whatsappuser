# WhatsApp Automation API Documentation

All endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token_here>
```

> **Note:** All `userId` fields are optional — if not provided, the system resolves the user from your JWT token automatically.
> **Mobile numbers** without country code (10 digits) are auto-converted to include `91` prefix.

---

## 1. WhatsApp Status Check

Check the current WhatsApp connection status of a session.

- **URL:** `GET /api/session/status`
- **Method:** `GET`
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:**

| Param    | Type   | Required | Description                          |
|----------|--------|----------|--------------------------------------|
| `userId` | number | Optional | The user ID to check status for.     |

**Example Request:**
```
GET /api/session/status?userId=3
```

**Response — Connected:**
```json
{
  "userId": "3",
  "status": "CONNECTED",
  "user": {
    "id": "919876543210@s.whatsapp.net",
    "name": "My Business Phone",
    "phone": "919876543210"
  }
}
```

**Response — Disconnected:**
```json
{
  "userId": "3",
  "status": "DISCONNECTED"
}
```

---

## 2. Logout Session

Disconnect and clear WhatsApp session credentials.

- **URL:** `POST /api/session/logout`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**

| Field    | Type   | Required | Description                          |
|----------|--------|----------|--------------------------------------|
| `userId` | number | Optional | The user ID whose session to logout. |

**Example Request Body:**
```json
{
  "userId": 3
}
```

**Response:**
```json
{
  "message": "Session logged out and cleaned up",
  "userId": "3",
  "status": "DISCONNECTED"
}
```

---

## 3. Send Message

Send a text message to a WhatsApp number.

- **URL:** `POST /api/message/send`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body:**

| Field    | Type   | Required | Description                                             |
|----------|--------|----------|---------------------------------------------------------|
| `userId` | number | Optional | The user ID whose WhatsApp session to send from.        |
| `to`     | string | Required | Recipient mobile number (10-digit or with 91 prefix).   |
| `message`| string | Required | The text message to send.                               |

> **Auto Prefix:** If `to` is a 10-digit number (e.g. `9876543210`), `91` is automatically added.

**Example Request Body:**
```json
{
  "userId": 3,
  "to": "9876543210",
  "message": "Hello! Your order has been confirmed."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "userId": "3",
  "to": "919876543210",
  "messageId": "3EB0A12BC4DF7E120A10",
  "status": "SENT"
}
```

---

## 4. Send Media File

Send an image, video, audio, or document file to a WhatsApp number by uploading a file directly.

- **URL:** `POST /api/message/send-media`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`
- **Content-Type:** `multipart/form-data`
- **Form Fields:**

| Field    | Type   | Required | Description                                              |
|----------|--------|----------|----------------------------------------------------------|
| `userId` | number | Optional | The user ID whose WhatsApp session to send from.         |
| `to`     | string | Required | Recipient mobile number (10-digit or with 91 prefix).    |
| `file`   | file   | Required | The media file to send (image, video, audio, document).  |
| `message`| string | Optional | Caption or message text to include with the media.       |

> **Supported file types:** `.jpg`, `.png`, `.gif`, `.mp4`, `.mp3`, `.pdf`, `.doc`, `.docx`, `.xlsx`, etc.
> **Auto Prefix:** If `to` is a 10-digit number, `91` is automatically added.

**Example cURL:**
```bash
curl -X POST http://localhost:3005/api/message/send-media \
  -H "Authorization: Bearer <token>" \
  -F "userId=3" \
  -F "to=9876543210" \
  -F "message=Please find your invoice attached." \
  -F "file=@/path/to/invoice.pdf"
```

**Response:**
```json
{
  "success": true,
  "message": "Media sent successfully",
  "userId": "3",
  "to": "919876543210",
  "mediaType": "document",
  "fileName": "invoice.pdf",
  "messageId": "3EB0A98F7A8B7C6D5E4F",
  "status": "SENT"
}
```

---

## 5. Bulk Messaging via Excel

Upload an Excel sheet to parse contacts and generate personalized messages.

- **URL:** `POST /api/message/parse-excel`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`
- **Content-Type:** `multipart/form-data`
- **Form Fields:**

| Field     | Type   | Required | Description                                                 |
|-----------|--------|----------|-------------------------------------------------------------|
| `file`    | file   | Required | Excel file (`.xlsx` or `.xls`) with a phone number column.  |
| `message` | string | Required | Message template. Use `{ColumnName}` as placeholders.       |

> **Phone Column:** The Excel must have a column named `phone`, `mobile`, `number`, `phonenumber`, etc.
> **Auto Prefix:** 10-digit numbers get `91` prepended automatically.
> **Placeholders:** Any column value can be used as `{ColumnName}` in the message template.

**Example Request (cURL):**
```bash
curl -X POST http://localhost:3005/api/message/parse-excel \
  -H "Authorization: Bearer <token>" \
  -F "message=Hello {Name}, your promo code is {Code}!" \
  -F "file=@/path/to/contacts.xlsx"
```

**Response:**
```json
{
  "success": true,
  "phoneColumnUsed": "phonenumber",
  "recipientCount": 2,
  "tasks": [
    {
      "id": 1,
      "phone": "919876543210",
      "originalPhone": "9876543210",
      "message": "Hello Alice, your promo code is SAVE20!",
      "rowData": { "Name": "Alice", "phonenumber": "9876543210", "Code": "SAVE20" }
    },
    {
      "id": 2,
      "phone": "919876543211",
      "originalPhone": "9876543211",
      "message": "Hello Bob, your promo code is VIP50!",
      "rowData": { "Name": "Bob", "phonenumber": "9876543211", "Code": "VIP50" }
    }
  ]
}
```

---

## 6. Get Profile Info

Fetch the profile display picture URL of any WhatsApp contact.

- **URL:** `GET /api/profile`
- **Method:** `GET`
- **Headers:** `Authorization: Bearer <token>`
- **Query Params:**

| Param   | Type   | Required | Description                                              |
|---------|--------|----------|----------------------------------------------------------|
| `phone` | string | Optional | Contact phone number to look up. Defaults to own profile.|

**Example Request:**
```
GET /api/profile?phone=919876543210
```

**Response:**
```json
{
  "userId": "3",
  "jid": "919876543210@s.whatsapp.net",
  "pictureUrl": "https://pps.whatsapp.net/v/t61.24694..."
}
```
