# Project Icon & Color Migration

## Overview
This migration adds `icon` and `color` columns to the `projects` table to support customizable project icons with color themes.

## Migration File
- **File**: `20251130_add_icon_color_to_projects.sql`
- **Location**: `current legacy client/supabase/migrations/`

## To Apply Migration

### Using Supabase CLI
```bash
supabase db push
```

### Manual SQL Execution
Run the following SQL in your Supabase SQL Editor:

```sql
alter table if exists public.projects
  add column if not exists icon text default 'file',
  add column if not exists color text default 'white';

comment on column public.projects.icon is 'Icon identifier for the project (e.g., file, dollar, briefcase, etc.)';
comment on column public.projects.color is 'Color identifier for the project icon (e.g., white, blue, green, etc.)';
```

## Default Values
- **icon**: `'file'` - Default file icon
- **color**: `'white'` - Default white color

## Available Icons
- file, dollar, briefcase, graduation, heart, plane, code, palette, music, camera
- book, cart, wrench, leaf, star, zap, trophy, target, clock, globe

## Available Colors
- white, green, blue, purple, pink, orange, red

These colors match the accent color theme options in the app.
