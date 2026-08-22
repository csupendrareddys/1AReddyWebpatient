# Configuration System

> **Status**: 🔄 In Progress (75%)  
> **Stack**: Flask-SQLAlchemy, PostgreSQL, AWS S3, React

---

## Overview

The Configuration System enables dynamic, database-driven UI customization for login pages and other configurable screens. It supports a SaaS multi-tenant approach with draft/preview/publish workflow.

---

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| Login Page Config (v1) | ✅ Complete | Basic field toggles |
| Dynamic Form Fields | ✅ Complete | Configurable login fields |
| User Type Selection | ✅ Complete | Patient/Doctor/Admin tabs |
| Extra Buttons | ✅ Complete | Custom action buttons |
| Page Config (v2) | 🔄 In Progress | Advanced draft/publish |
| Asset Management | 🔄 In Progress | S3 logo/image uploads |
| Preview Mode | 🔄 In Progress | Preview before publish |

---

## Login Page Configuration (v1)

### LoginPageConfig Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `page_type` | String | e.g., patient_login, doctor_login |
| `is_active` | Boolean | Currently active config |
| `logo_url` | String | Header logo URL |
| `title` | String | Page title |
| `subtitle` | String | Page subtitle |
| `show_logo` | Boolean | Toggle logo visibility |
| `show_title` | Boolean | Toggle title |
| `show_forgot_password` | Boolean | Toggle forgot password link |
| `show_signup_link` | Boolean | Toggle signup link |
| `show_social_login` | Boolean | Toggle social auth |
| `custom_css` | Text | Custom styling |
| `primary_color` | String | Theme color |
| `background_image_url` | String | Background image |

### LoginFieldConfig Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `config_id` | UUID | FK to LoginPageConfig |
| `field_name` | String | Internal name |
| `field_label` | String | Display label |
| `field_type` | String | text, password, email, tel |
| `placeholder` | String | Placeholder text |
| `is_required` | Boolean | Required field |
| `is_enabled` | Boolean | Show/hide field |
| `display_order` | Integer | Field order |
| `validation_regex` | String | Validation pattern |
| `error_message` | String | Validation error |

### UserTypeConfig Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `config_id` | UUID | FK to LoginPageConfig |
| `user_type` | String | patient, doctor, admin |
| `display_name` | String | Tab label |
| `icon` | String | Icon name |
| `is_enabled` | Boolean | Show/hide tab |
| `display_order` | Integer | Tab order |

### ExtraButtonConfig Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `config_id` | UUID | FK to LoginPageConfig |
| `button_text` | String | Button label |
| `button_type` | String | link, action |
| `action_url` | String | Destination URL |
| `icon` | String | Button icon |
| `is_enabled` | Boolean | Show/hide |
| `display_order` | Integer | Order |
| `style_variant` | String | outlined, contained |

---

## Page Configuration (v2)

### Workflow States

| Status | Code | Description |
|--------|------|-------------|
| Draft | `draft` | Work in progress |
| Preview | `preview` | Available for preview |
| Live | `live` | Currently active |
| Archived | `archived` | Historical version |

### PageConfigAsset Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `asset_type` | Enum | logo, favicon, background_image, etc. |
| `s3_key` | String | S3 object key |
| `original_filename` | String | Original file name |
| `content_type` | String | MIME type |
| `file_size` | Integer | Size in bytes |
| `uploaded_by_id` | UUID | Admin who uploaded |
| `created_at` | DateTime | Upload timestamp |

### Asset Types

| Type | Code | Purpose |
|------|------|---------|
| Logo | `logo` | Header logo |
| Favicon | `favicon` | Browser tab icon |
| Background | `background_image` | Page background |
| Terms | `terms_document` | Terms PDF |
| Privacy | `privacy_document` | Privacy policy PDF |

---

## API Endpoints

### Login Config API (`/api/config/login`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get active login config |
| GET | `/<page_type>` | Get config by page type |
| PUT | `/` | Update login config |
| POST | `/fields` | Add form field |
| PUT | `/fields/<id>` | Update form field |
| DELETE | `/fields/<id>` | Delete form field |

### Page Config API (`/api/page-config`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all page configs |
| POST | `/` | Create new config |
| GET | `/<id>` | Get config by ID |
| PUT | `/<id>` | Update config |
| POST | `/<id>/preview` | Set to preview mode |
| POST | `/<id>/publish` | Publish config (go live) |
| POST | `/<id>/archive` | Archive config |

### Asset API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/assets/upload` | Upload asset to S3 |
| GET | `/assets/<id>` | Get asset with presigned URL |
| DELETE | `/assets/<id>` | Delete asset |

---

## Frontend Integration

### Login Config Page

```jsx
// LoginConfigPage.jsx
const LoginConfigPage = () => {
  const { data: config } = useGetLoginConfigQuery();
  const [updateConfig] = useUpdateLoginConfigMutation();
  
  return (
    <ConfigForm
      initialValues={config}
      onSubmit={updateConfig}
    />
  );
};
```

### Dynamic Login Form

```jsx
// DynamicLoginPage.jsx
const DynamicLoginPage = () => {
  const { data: config } = useGetLoginConfigQuery('patient_login');
  
  return (
    <LoginForm
      fields={config.fields}
      logo={config.logo_url}
      title={config.title}
      showForgotPassword={config.show_forgot_password}
    />
  );
};
```

---

## S3 Asset Storage

### Configuration

```python
AWS_S3_BUCKET = 'jlmush-assets'
AWS_S3_REGION = 'ap-south-1'
```

### Presigned URLs

```python
def get_presigned_url(self, expiration=3600):
    """Generate temporary URL for S3 asset."""
    s3_client = boto3.client('s3')
    return s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': self.s3_key},
        ExpiresIn=expiration
    )
```

---

## Future Enhancements

- [ ] Theme presets
- [ ] Version comparison
- [ ] A/B testing support
- [ ] Multi-language support
- [ ] Config import/export

---

*Last Updated: January 31, 2026*
