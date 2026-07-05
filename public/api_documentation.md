# WhatsApp Automation API Documentation

All endpoints require a valid JWT token in the Authorization header:

```http
Authorization: Bearer <your_jwt_token_here>
```

The API resolves the WhatsApp session from your JWT token automatically.

Mobile numbers without a country code, for example `9876543210`, are automatically converted with the `91` prefix.

---

## 1. WhatsApp Status Check

Check the current WhatsApp connection status for your account.

- **URL:** `GET /api/session/status`
- **Method:** `GET`
- **Headers:** `Authorization: Bearer <token>`

**Example Request:**

```http
GET /api/session/status
```

**Response - Connected:**

```json
{
  "status": "CONNECTED",
  "user": {
    "id": "919876543210@s.whatsapp.net",
    "name": "My Business Phone",
    "phone": "919876543210"
  }
}
```

**Response - Disconnected:**

```json
{
  "status": "DISCONNECTED"
}
```

---

## 2. Logout Session

Disconnect and clear your WhatsApp session credentials.

- **URL:** `POST /api/session/logout`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`

**Example Request:**

```http
POST /api/session/logout
```

**Response:**

```json
{
  "message": "Session logged out and cleaned up",
  "status": "DISCONNECTED"
}
```

---

## 3. Send Message

Send a text message to a WhatsApp number.

- **URL:** `POST /api/message/send`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request Body:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `to` | string | Required | Recipient mobile number, 10-digit or with `91` prefix. |
| `message` | string | Required | The text message to send. |

**Example Request Body:**

```json
{
  "to": "9876543210",
  "message": "Hello! Your order has been confirmed."
}
```

**Response:**

```json
{
  "success": true,
  "message": "Message sent successfully",
  "to": "919876543210",
  "messageId": "3EB0A12BC4DF7E120A10",
  "status": "SENT"
}
```

---

## 4. Send Media

Send an image, video, audio, or document to a WhatsApp number.

- **URL:** `POST /api/message/send`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request Body:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `to` | string | Required | Recipient mobile number, 10-digit or with `91` prefix. |
| `mediaUrl` | string | Required | Public file URL or base64 data URL. |
| `mediaType` | string | Required | One of `image`, `video`, `audio`, or `document`. |
| `caption` | string | Optional | Caption for image, video, or document. |
| `fileName` | string | Optional | File name for document media. |
| `mimetype` | string | Optional | MIME type override, for example `application/pdf`. |

**Example Request Body:**

```json
{
  "to": "9876543210",
  "mediaUrl": "https://example.com/invoice.pdf",
  "mediaType": "document",
  "caption": "Please find your invoice attached.",
  "fileName": "invoice.pdf",
  "mimetype": "application/pdf"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Media sent successfully",
  "to": "919876543210",
  "messageId": "3EB0A98F7A8B7C6D5E4F",
  "status": "SENT"
}
```

---

## 5. Get Profile Info

Fetch the profile picture URL for your own WhatsApp account or another WhatsApp contact.

- **URL:** `GET /api/profile`
- **Method:** `GET`
- **Headers:** `Authorization: Bearer <token>`

**Query Params:**

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `phone` | string | Optional | Contact phone number to look up. If omitted, returns own profile. |

**Example Request:**

```http
GET /api/profile?phone=919876543210
```

**Response:**

```json
{
  "phone": "919876543210",
  "profilePictureUrl": "https://pps.whatsapp.net/v/t61.24694..."
}
```
