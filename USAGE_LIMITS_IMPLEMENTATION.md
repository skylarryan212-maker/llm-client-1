# Usage Limits Implementation

## Overview
Comprehensive per-user monthly usage limits have been implemented to ensure profitability while providing fair access across all plan tiers. Limits are based on API costs and reset monthly.

## Plan Tiers & Limits

### Profitability Analysis

**Cost Structure:**
- Average GPT 5.1 message: ~$0.006
- GPT 5 Nano (titles): ~$0.0001
- Vector storage: ~$0.0001 per file
- Whisper transcription: ~$0.0003 per minute

**Tier Limits (Monthly):**

| Plan Tier | Price/Month | API Limit | Profit Margin | Avg Messages* |
|-----------|-------------|-----------|---------------|---------------|
| **Free** | $0 | $2.00 | -$2.00 (loss) | ~330 messages |
| **Plus** | $15 | $10.00 | $5.00 (33%) | ~1,650 messages |
| **Pro** | $25 | $20.00 | $5.00 (20%) | ~3,300 messages |
| **Dev** | $100 | $80.00 | $20.00 (20%) | ~13,300 messages |

*Based on GPT 5.1 usage with flex pricing for free tier

### Free Tier Strategy
The free tier operates at a $2/month loss per user, which is a common acquisition cost in SaaS:
- Allows 330+ messages (very generous trial)
- Uses flex processing (50% cost reduction)
- Provides excellent product experience
- Converts to paid at ~15-20% (industry standard)
- **Break-even:** 1 free user = 1 paid Plus user needed

### Recommended Adjustments by User Behavior

If most users prefer **GPT 5 Mini** instead of GPT 5.1:
- Average message cost: ~$0.0012
- Free: ~1,650 messages/month
- Plus: ~8,300 messages/month
- Pro: ~16,600 messages/month
- Dev: ~66,600 messages/month

**Recommendation:** Monitor actual usage patterns for 30 days, then adjust limits based on:
1. Average model preference (5.1 vs Mini vs Nano)
2. Conversion rate from free to paid
3. Churn rate after hitting limits

## Implementation Details

### Core Files

#### 1. Usage Limits Library
**File:** `new-client/lib/usage-limits.ts`

```typescript
export const PLAN_LIMITS = {
  free: 2.00,
  plus: 10.00,
  pro: 20.00,
  dev: 80.00,
} as const;
```

**Functions:**
- `getPlanLimit(planType)` - Get monthly limit for plan
- `hasExceededLimit(spending, planType)` - Check if user exceeded
- `getWarningThreshold(planType)` - Get 80% warning threshold
- `calculateUsagePercentage(spending, planType)` - Get usage percentage
- `getRemainingBudget(spending, planType)` - Get remaining credits
- `getUsageStatus(spending, planType)` - Get complete status object

#### 2. Usage Tracking Actions
**File:** `new-client/app/actions/usage-actions.ts`

**New Function:** `getMonthlySpending()`
- Queries user_api_usage table
- Filters by current month (starts on 1st)
- Returns total spending for current billing cycle

**Existing:** `getUserTotalSpending()`
- Returns all-time total spending
- Used for historical tracking

#### 3. Chat API Protection
**File:** `new-client/app/api/chat/route.ts`

**Added Protection:**
```typescript
// Check usage limits before processing
const userPlan = await getUserPlan();
const monthlySpending = await getMonthlySpending();

if (hasExceededLimit(monthlySpending, userPlan)) {
  return NextResponse.json(
    { 
      error: "Usage limit exceeded",
      message: "You've reached your monthly limit...",
      currentSpending: monthlySpending,
      limit: planLimit,
      planType: userPlan
    },
    { status: 429 }
  );
}
```

**Performance Note:** This adds 2 database queries per message:
1. Get user plan (fast, single row)
2. Get monthly spending (aggregation on indexed created_at)

To optimize for high volume:
- Add Redis cache for plan lookups (5 min TTL)
- Add Redis cache for monthly spending (1 min TTL)
- Update spending cache on each API call

### UI Components

#### 1. API Usage Badge (Updated)
**File:** `new-client/components/api-usage-badge.tsx`

**Features:**
- Shows monthly spending vs limit: "$0.1234 / $2.00"
- Color-coded status:
  - Green (default): < 80% used
  - Yellow (warning): 80-100% used
  - Red (exceeded): ≥ 100% used
- Warning icon when approaching/exceeding limit
- Auto-updates after each API call

**Visual States:**
```
Normal:   💵 $0.4523 / $2.00
Warning:  ⚠️ $1.7890 / $2.00  (yellow)
Exceeded: ⚠️ $2.0123 / $2.00  (red)
```

#### 2. Settings Modal (Enhanced)
**File:** `new-client/components/settings-modal.tsx`

**New Features:**
- Monthly usage progress bar with color coding
- Percentage used display
- Remaining budget display
- All-time total (separate from monthly)
- Warning messages at 80% and 100%

**Account Tab Layout:**
```
┌─────────────────────────────────┐
│ API Usage (This Month)          │
│                                 │
│ $1.2345                of $2.00 │
│ ████████████████░░░░░░ 61.7%    │
│ $0.7655 remaining               │
│                                 │
│ All-time total: $3.4567         │
└─────────────────────────────────┘
```

#### 3. Usage Limit Modal (New)
**File:** `new-client/components/usage-limit-modal.tsx`

**Triggered When:**
- User tries to send message after exceeding limit
- Chat API returns 429 status
- Custom event 'usage-limit-exceeded' fired

**Features:**
- Shows current spending vs limit
- 100% progress bar (visual impact)
- Explains monthly reset
- Recommends next tier upgrade
- Shows upgrade pricing
- "View Plans" CTA button
- "Close" option

**Example Display:**
```
⚠️ Monthly Usage Limit Reached

You've used $2.0123 of your $2.00 monthly limit

Current Plan: Free
████████████████████████ 100% used

Your free plan includes $2.00 of API usage per month.
This resets on the 1st of each month.

┌────────────────────────────────┐
│ Upgrade to Plus                │
│ $10 monthly API usage          │
│                          $15   │
│                      per month │
└────────────────────────────────┘

[Close]  [View Plans →]

Your usage will automatically reset on the 1st of next month
```

### Event System

**Chat API → UI Communication:**

1. **API Response (429):**
```json
{
  "error": "Usage limit exceeded",
  "message": "You've reached your monthly limit of $2.00...",
  "currentSpending": 2.0123,
  "limit": 2.00,
  "planType": "free"
}
```

2. **Chat Shell Dispatches Event:**
```typescript
window.dispatchEvent(new CustomEvent('usage-limit-exceeded', {
  detail: {
    currentSpending: 2.0123,
    limit: 2.00,
    planType: 'free'
  }
}));
```

3. **Modal Opens Automatically:**
- Event listener in chat-page-shell.tsx
- Sets state to open UsageLimitModal
- User sees clear explanation and upgrade path

### Database Queries

**Monthly Spending Query:**
```sql
SELECT estimated_cost
FROM user_api_usage
WHERE user_id = $1
  AND created_at >= $2  -- First day of current month
```

**Optimization Opportunities:**
1. Add composite index: `(user_id, created_at, estimated_cost)`
2. Add materialized view for monthly totals (refreshed hourly)
3. Add Redis cache with 1-minute TTL

### Reset Logic

**Monthly Reset:**
- Limits reset automatically on the 1st of each month
- No cronjob needed (query filters by `created_at >= startOfMonth`)
- Users get fresh limit at midnight UTC on the 1st

**Manual Reset (Admin Tool - Not Implemented):**
```typescript
// Future feature: Admin can reset user's monthly usage
await supabase
  .from('user_api_usage')
  .delete()
  .eq('user_id', userId)
  .gte('created_at', startOfCurrentMonth);
```

## User Experience Flow

### Happy Path (Under Limit)
1. User sends message
2. API checks limit → ✅ Under limit
3. Message processed normally
4. Cost logged to database
5. Badge updates: "$0.1234 / $2.00"

### Warning Path (80-100%)
1. User sends message
2. API checks limit → ✅ Under limit (but close)
3. Message processed
4. Badge turns yellow: "⚠️ $1.7890 / $2.00"
5. Settings shows warning: "⚠️ You're approaching your monthly limit"

### Limit Exceeded Path
1. User sends message
2. API checks limit → ❌ Exceeded
3. API returns 429 error
4. Modal appears: "Monthly Usage Limit Reached"
5. User sees upgrade options
6. Click "View Plans" → `/upgrade` page

### After Upgrade
1. User upgrades to Plus plan
2. New limit: $10.00/month
3. Current spending: $2.01 (carries over)
4. Remaining: $7.99
5. Can continue chatting immediately

## Testing Guide

### Test Free Tier Limit

1. **Simulate High Usage:**
```sql
-- Insert fake usage to reach limit
INSERT INTO user_api_usage (id, user_id, conversation_id, model, estimated_cost)
VALUES 
  (gen_random_uuid(), '<your-user-id>', '<conversation-id>', 'gpt-5.1-2025-11-13', 1.95),
  (gen_random_uuid(), '<your-user-id>', '<conversation-id>', 'gpt-5.1-2025-11-13', 0.05);
```

2. **Expected Behavior:**
- Badge shows: "⚠️ $2.0000 / $2.00" (red)
- Settings shows 100% progress bar
- Next message attempt shows modal

3. **Test Warning Threshold:**
```sql
-- Insert $1.70 to trigger 85% warning
INSERT INTO user_api_usage (id, user_id, conversation_id, model, estimated_cost)
VALUES (gen_random_uuid(), '<your-user-id>', '<conversation-id>', 'gpt-5.1-2025-11-13', 1.70);
```

Expected:
- Badge shows: "⚠️ $1.7000 / $2.00" (yellow)
- Settings shows warning message

### Test Monthly Reset

1. **Modify created_at to Last Month:**
```sql
UPDATE user_api_usage
SET created_at = NOW() - INTERVAL '35 days'
WHERE user_id = '<your-user-id>';
```

2. **Expected Behavior:**
- Badge shows: "$0.0000 / $2.00"
- Settings shows 0% used
- Old usage doesn't count toward current month

### Test Plan Upgrade

1. Start as free user with $1.95 spent
2. Upgrade to Plus plan (settings → account → upgrade)
3. Expected:
   - Limit changes from $2.00 → $10.00
   - Current spending stays $1.95
   - Remaining: $8.05
   - Can continue chatting

## Future Enhancements

### 1. Usage Analytics Dashboard
**Location:** New page `/usage`

**Features:**
- Daily spending chart (last 30 days)
- Breakdown by service:
  - Chat completions: $X.XX (XX%)
  - Title generation: $X.XX (XX%)
  - File uploads: $X.XX (XX%)
  - Transcriptions: $X.XX (XX%)
- Most expensive conversations
- Model usage distribution
- Projected monthly total

### 2. Smart Alerts
**Email Notifications:**
- 50% used: "You've used half your monthly limit"
- 80% used: "Approaching your limit - consider upgrading"
- 100% used: "Limit reached - upgrade to continue"
- 3 days before reset: "Your limit resets in 3 days"

### 3. Overage Protection
**Options:**
- Hard stop (current implementation)
- Pay-per-use overage ($0.01 per message)
- Automatic upgrade to next tier
- Burst allowance (10% over limit tolerated)

### 4. Team Plans
**Multi-user support:**
- Shared pool of credits
- Usage by team member
- Admin controls and limits
- Billing to organization

### 5. API Rate Limiting
**Beyond monthly limits:**
- 60 messages per hour (free)
- 300 messages per hour (plus)
- 1000 messages per hour (pro)
- Unlimited (dev)

Prevents abuse and API quota exhaustion.

### 6. Cost Optimization Features
**Help users save money:**
- Auto-switch to Nano for simple questions
- Batch title generation (1x per day instead of per conversation)
- Compress old vector stores
- Suggest switching to Mini model
- "Economy mode" toggle (always use cheapest model)

## Monitoring & Metrics

### Key Metrics to Track

1. **Average Cost Per User (by Plan)**
   ```sql
   SELECT 
     up.plan_type,
     AVG(monthly_spending) as avg_monthly_cost
   FROM (
     SELECT 
       user_id,
       SUM(estimated_cost) as monthly_spending
     FROM user_api_usage
     WHERE created_at >= DATE_TRUNC('month', NOW())
     GROUP BY user_id
   ) AS monthly
   JOIN user_plans up ON up.user_id = monthly.user_id
   GROUP BY up.plan_type;
   ```

2. **Limit Exceeded Rate**
   ```sql
   SELECT 
     COUNT(DISTINCT user_id) FILTER (WHERE monthly_spending >= limit) * 100.0 / COUNT(DISTINCT user_id) as exceeded_pct
   FROM (monthly spending query with limits)
   ```

3. **Conversion After Limit Hit**
   - Track users who hit limit
   - Track plan upgrades within 7 days
   - Calculate conversion rate

4. **Model Preference Distribution**
   ```sql
   SELECT 
     model,
     COUNT(*) as usage_count,
     SUM(estimated_cost) as total_cost
   FROM user_api_usage
   WHERE created_at >= DATE_TRUNC('month', NOW())
   GROUP BY model
   ORDER BY usage_count DESC;
   ```

### Profitability Alerts

**When to Adjust Limits:**
- Free users averaging > $2.50/month → Reduce limit or conversion
- Plus users averaging < $5/month → Can increase limit
- Conversion rate < 10% → Limits may be too generous
- Churn rate > 30% after limit → Limits may be too strict

## Conclusion

This implementation provides:
✅ Fair, profitable limits for each tier
✅ Transparent usage tracking for users
✅ Clear upgrade path when limits reached
✅ Automatic monthly reset
✅ Protection against runaway costs
✅ Positive user experience

**Next Steps:**
1. Monitor usage for 30 days
2. Analyze conversion rates
3. Adjust limits based on actual patterns
4. Implement advanced analytics
5. Add email notifications
6. Consider overage options

The current limits provide excellent value while maintaining profitability at scale.
