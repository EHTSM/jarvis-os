# Business OS Frontend Coverage

## Screens

- Business Dashboard
- Leads
- Contacts
- Opportunities
- Campaigns
- Revenue

## Business API coverage

- Leads
  - `POST /business/leads`
  - `GET /business/leads`
  - `GET /business/leads/:id`
  - `PATCH /business/leads/:id`
  - `POST /business/leads/:id/qualify`
  - `POST /business/leads/:id/disqualify`
  - `DELETE /business/leads/:id`

- Contacts
  - `POST /business/contacts`
  - `GET /business/contacts`
  - `GET /business/contacts/:id`
  - `PATCH /business/contacts/:id`
  - `DELETE /business/contacts/:id`

- Opportunities
  - `POST /business/opportunities`
  - `GET /business/opportunities`
  - `GET /business/opportunities/:id`
  - `PATCH /business/opportunities/:id`
  - `POST /business/opportunities/:id/advance`
  - `POST /business/opportunities/:id/close-won`
  - `POST /business/opportunities/:id/close-lost`

- Campaigns
  - `POST /business/campaigns`
  - `GET /business/campaigns`
  - `GET /business/campaigns/:id`
  - `PATCH /business/campaigns/:id`
  - `POST /business/campaigns/:id/event`
  - `POST /business/campaigns/:id/complete`

- Revenue
  - `POST /business/revenue`
  - `GET /business/revenue`
  - `GET /business/revenue/stats`

- Dashboard & summaries
  - `GET /business/dashboard`
  - `GET /business/summary/daily`
  - `GET /business/summary/weekly`
  - `GET /business/pipeline`
  - `GET /business/search`
  - `GET /business/stats`

## Notes

- Business Dashboard now supports weekly summary data.
- The frontend is confirmed buildable after the integration changes.
