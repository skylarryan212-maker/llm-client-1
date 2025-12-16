// Monthly API usage limits per plan tier (in USD)
export const PLAN_LIMITS = {
  free: 2.0,    // $2/month
  plus: 5.0,    // Basic
  pro: 15.0,    // Plus
  dev: 150.0,   // Dev
} as const;

export type PlanType = keyof typeof PLAN_LIMITS;

export function getPlanLimit(planType: PlanType | string): number {
  if (planType in PLAN_LIMITS) {
    return PLAN_LIMITS[planType as PlanType];
  }
  return PLAN_LIMITS.free; // Default to free tier limit
}

export function calculateUsagePercentage(spending: number, planType: PlanType | string): number {
  const limit = getPlanLimit(planType);
  return (spending / limit) * 100;
}

export function getRemainingBudget(spending: number, planType: PlanType | string): number {
  const limit = getPlanLimit(planType);
  return Math.max(0, limit - spending);
}

export function hasExceededLimit(spending: number, planType: PlanType | string): boolean {
  const limit = getPlanLimit(planType);
  return spending >= limit;
}

export function getWarningThreshold(planType: PlanType | string): number {
  // Warn at 80% of limit
  return getPlanLimit(planType) * 0.8;
}

export function shouldShowWarning(spending: number, planType: PlanType | string): boolean {
  return spending >= getWarningThreshold(planType) && !hasExceededLimit(spending, planType);
}

export function getUsageStatus(spending: number, planType: PlanType | string): {
  exceeded: boolean;
  warning: boolean;
  percentage: number;
  remaining: number;
  limit: number;
} {
  const limit = getPlanLimit(planType);
  const percentage = calculateUsagePercentage(spending, planType);
  const remaining = getRemainingBudget(spending, planType);
  const exceeded = hasExceededLimit(spending, planType);
  const warning = shouldShowWarning(spending, planType);

  return {
    exceeded,
    warning,
    percentage,
    remaining,
    limit,
  };
}
