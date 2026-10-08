from pydantic import BaseModel
from sqlalchemy import text, select
from dateutil.relativedelta import relativedelta
from app.models.transaction import Transaction
from app.core.workspace_context import current_writable_workspace
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import WorkspaceContext, current_workspace
from app.schemas.report import ReportResponse
from app.services import report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Cap the user-picked custom range so wide windows can't tie up the DB with
# per-day snapshot fan-out. Ten years covers every realistic personal-finance
# question and stays inside the existing daily-interval budget.
_MAX_CUSTOM_RANGE_YEARS = 10


def _add_years(value: date, years: int) -> date:
    """Add whole calendar years to a date.

    Clamps Feb 29 to Feb 28 when the target year isn't a leap year, so the
    result is always a valid calendar date rather than raising.
    """
    try:
        return value.replace(year=value.year + years)
    except ValueError:
        return date(value.year + years, 2, 28)


def _financial_year_start_month(tax_jurisdiction: str | None) -> int:
    """Return the first month of the workspace's financial year."""
    return 4 if (tax_jurisdiction or "").upper() == "IN" else 1


def _reject_unsupported_fiscal_year_report(
    period: str | None, interval: str, financial_year_start_month: int
) -> None:
    if period == "ytd" and interval == "yearly" and financial_year_start_month != 1:
        raise HTTPException(
            status_code=422,
            detail="Yearly YTD reports are not supported for non-calendar financial years",
        )


def _resolve_custom_range(
    start_date: date | None, end_date: date | None
) -> tuple[date | None, date | None]:
    """Validate a user-supplied custom range and return the (start, end) pair.

    Both endpoints must be provided together; the range must be non-empty,
    end no later than today and stay within :data:`_MAX_CUSTOM_RANGE_YEARS`
    calendar years of start_date. Returns ``(None, None)`` when neither is
    set, so callers can use presets.
    """
    if start_date is None and end_date is None:
        return None, None
    if start_date is None or end_date is None:
        raise HTTPException(
            status_code=422,
            detail="start_date and end_date must be provided together",
        )
    if end_date < start_date:
        raise HTTPException(
            status_code=422,
            detail="end_date must be on or after start_date",
        )
    if end_date > date.today():
        raise HTTPException(
            status_code=422,
            detail="end_date must be on or before today",
        )
    max_end_date = _add_years(start_date, _MAX_CUSTOM_RANGE_YEARS)
    if end_date > max_end_date:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Custom range is too wide (max {_MAX_CUSTOM_RANGE_YEARS} years)"
            ),
        )
    return start_date, end_date


@router.get("/net-worth", response_model=ReportResponse)
async def get_net_worth(
    months: int = Query(12, ge=1, le=24),
    interval: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    account_ids: Optional[list[uuid.UUID]] = Query(None),
    asset_group_ids: Optional[list[uuid.UUID]] = Query(None),
    period: str | None = Query(None, pattern="^ytd$"),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    financial_year_start_month = _financial_year_start_month(ctx.workspace.tax_jurisdiction)
    custom_start, custom_end = _resolve_custom_range(start_date, end_date)
    effective_period = None if custom_start is not None else period
    _reject_unsupported_fiscal_year_report(
        effective_period, interval, financial_year_start_month
    )
    return await report_service.get_net_worth_report(
        session, ctx.workspace.id, ctx.user_id, months, interval, ctx.user.primary_currency,
        account_ids=account_ids, asset_group_ids=asset_group_ids, period=effective_period,
        financial_year_start_month=financial_year_start_month,
        start_date=custom_start, end_date=custom_end,
    )


@router.get("/income-expenses", response_model=ReportResponse)
async def get_income_expenses(
    months: int = Query(12, ge=1, le=24),
    interval: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    account_ids: Optional[list[uuid.UUID]] = Query(None),
    period: str | None = Query(None, pattern="^ytd$"),
    days: Optional[int] = Query(None, ge=1, le=730),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    """`days` overrides `months` with an exact rolling window ending today.

    Alternatively `start_date`/`end_date` (both required together) pin the
    window to an explicit historical calendar range, overriding `months`,
    `period`, and `days`. Custom ranges include actuals only, without estimates.
    """
    financial_year_start_month = _financial_year_start_month(ctx.workspace.tax_jurisdiction)
    custom_start, custom_end = _resolve_custom_range(start_date, end_date)
    effective_period = None if custom_start is not None else period
    _reject_unsupported_fiscal_year_report(
        effective_period, interval, financial_year_start_month
    )
    return await report_service.get_income_expenses_report(
        session, ctx.workspace.id, ctx.user_id, months, interval, ctx.user.primary_currency,
        account_ids=account_ids, period=effective_period, days=days,
        financial_year_start_month=financial_year_start_month,
        start_date=custom_start, end_date=custom_end,
    )


@router.get("/cash-flow", response_model=ReportResponse)
async def get_cash_flow(
    months: int = Query(6, ge=1, le=12),
    interval: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
    baseline: bool = Query(False),
    account_ids: Optional[list[uuid.UUID]] = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await report_service.get_cash_flow_report(
        session, ctx.workspace.id, ctx.user_id, months, interval, ctx.user.primary_currency,
        baseline=baseline, account_ids=account_ids,
    )


def _clean_uuid_param(val) -> Optional[uuid.UUID]:
    if isinstance(val, uuid.UUID):
        return val
    if isinstance(val, str) and val.strip() and val.strip().lower() not in ("none", "null", ""):
        try:
            return uuid.UUID(val.strip())
        except (ValueError, AttributeError):
            return None
    return None


class CreditCommitmentUpdate(BaseModel):
    description: Optional[str] = None
    category_id: Optional[str] = None
    asset_id: Optional[str] = None


@router.get("/credit-commitments")
async def get_credit_commitments(
    account_id: Optional[str] = Query(None),
    asset_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    query_str = """
        SELECT 
            a.id as account_id,
            a.name as account_name,
            t.id as tx_id,
            t.description,
            t.original_description,
            t.amount,
            t.installment_number,
            t.total_installments,
            t.installment_total_amount,
            t.date,
            c.id as category_id,
            c.name as category_name,
            c.color as category_color,
            c.icon as category_icon,
            ast.id as asset_id,
            ast.name as asset_name
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN assets ast ON ast.id = t.asset_id
        WHERE t.workspace_id = :workspace_id
          AND a.type = 'credit_card'
          AND t.total_installments IS NOT NULL
          AND t.is_ignored = false
    """
    clean_account_id = _clean_uuid_param(account_id)
    clean_asset_id = _clean_uuid_param(asset_id)
    clean_category_id = _clean_uuid_param(category_id)

    params = {"workspace_id": ctx.workspace.id}
    if clean_account_id:
        query_str += " AND a.id = :account_id"
        params["account_id"] = clean_account_id
    if clean_asset_id:
        query_str += " AND t.asset_id = :asset_id"
        params["asset_id"] = clean_asset_id
    if clean_category_id:
        query_str += " AND t.category_id = :category_id"
        params["category_id"] = clean_category_id

    query_str += " ORDER BY a.name, t.description"

    result = await session.execute(text(query_str), params)
    rows = result.fetchall()

    items = []
    total_remaining = 0.0
    total_initial = 0.0
    total_paid = 0.0
    max_remaining_months = 0
    by_account: dict[str, dict] = {}
    by_category: dict[str, dict] = {}
    by_asset: dict[str, dict] = {}

    for r in rows:
        (acct_id, acct_name, tx_id, desc, orig_desc, amount, inst_num, total_inst, inst_total_amt, 
         tx_date, cat_id, cat_name, cat_color, cat_icon, ast_id_val, ast_name_val) = r
        
        rem_months = max(0, total_inst - inst_num)
        amount_float = float(amount)
        init_amt = float(inst_total_amt) if inst_total_amt is not None else float(amount_float * total_inst)
        paid_amt = float(amount_float * inst_num)
        rem_amt = float(amount_float * rem_months)
        
        if rem_months > max_remaining_months:
            max_remaining_months = rem_months
            
        if rem_months > 0:
            total_remaining += rem_amt
            total_initial += init_amt
            total_paid += paid_amt

            acct_key = str(acct_id)
            if acct_key not in by_account:
                by_account[acct_key] = {
                    "account_id": acct_key,
                    "account_name": acct_name,
                    "total_remaining": 0.0,
                    "monthly_payment": 0.0,
                    "count": 0
                }
            by_account[acct_key]["total_remaining"] += rem_amt
            by_account[acct_key]["monthly_payment"] += amount_float
            by_account[acct_key]["count"] += 1

            cat_key = str(cat_id) if cat_id else "uncategorized"
            if cat_key not in by_category:
                by_category[cat_key] = {
                    "category_id": cat_key,
                    "category_name": cat_name or "Sin categoría",
                    "category_color": cat_color,
                    "category_icon": cat_icon,
                    "total_remaining": 0.0,
                    "monthly_payment": 0.0,
                    "count": 0
                }
            by_category[cat_key]["total_remaining"] += rem_amt
            by_category[cat_key]["monthly_payment"] += amount_float
            by_category[cat_key]["count"] += 1

            ast_key = str(ast_id_val) if ast_id_val else "none"
            if ast_key not in by_asset:
                by_asset[ast_key] = {
                    "asset_id": ast_key if ast_id_val else None,
                    "asset_name": ast_name_val or "Sin activo",
                    "total_remaining": 0.0,
                    "monthly_payment": 0.0,
                    "count": 0
                }
            by_asset[ast_key]["total_remaining"] += rem_amt
            by_asset[ast_key]["monthly_payment"] += amount_float
            by_asset[ast_key]["count"] += 1

        items.append({
            "id": str(tx_id),
            "account_id": str(acct_id),
            "account_name": acct_name,
            "description": desc,
            "original_description": orig_desc or desc,
            "monthly_amount": amount_float,
            "installment_number": inst_num,
            "total_installments": total_inst,
            "remaining_months": rem_months,
            "total_initial": round(init_amt, 2),
            "total_paid": round(paid_amt, 2),
            "remaining_amount": round(rem_amt, 2),
            "date": str(tx_date),
            "category_id": str(cat_id) if cat_id else None,
            "category_name": cat_name,
            "category_color": cat_color,
            "category_icon": cat_icon,
            "asset_id": str(ast_id_val) if ast_id_val else None,
            "asset_name": ast_name_val,
        })

    # Timeline projection: starts next cycle/month (or current month if today is in it)
    today = date.today()
    # If today is after the 20th or current month, project from current month forward
    base_month = date(today.year, today.month, 1)
    timeline = []
    for m_idx in range(1, max(max_remaining_months, 1) + 1):
        m_date = base_month + relativedelta(months=m_idx - 1)
        active_in_m = [i for i in items if i["remaining_months"] >= m_idx]
        m_sum = sum(i["monthly_amount"] for i in active_in_m)
        timeline.append({
            "month": m_date.strftime("%Y-%m"),
            "month_label": m_date.strftime("%b %Y"),
            "relative_month": m_idx,
            "total_committed": round(m_sum, 2),
            "active_items_count": len(active_in_m),
            "items": [
                {
                    "id": i["id"],
                    "description": i["description"],
                    "account_name": i["account_name"],
                    "monthly_amount": i["monthly_amount"],
                    "installment": f"{i['installment_number'] + m_idx}/{i['total_installments']}",
                    "category_name": i["category_name"],
                    "asset_name": i["asset_name"]
                }
                for i in active_in_m
            ]
        })

    active_items = [i for i in items if i["remaining_months"] > 0]
    next_month_payment = timeline[0]["total_committed"] if timeline else 0.0
    future_months_payment = sum(t["total_committed"] for t in timeline[1:]) if len(timeline) > 1 else 0.0

    return {
        "summary": {
            "total_remaining": round(total_remaining, 2),
            "total_initial": round(total_initial, 2),
            "total_paid": round(total_paid, 2),
            "monthly_current_month": next_month_payment,
            "monthly_future_total": round(future_months_payment, 2),
            "active_count": len(active_items),
            "completed_count": len(items) - len(active_items),
            "max_remaining_months": max_remaining_months,
            "by_account": list(by_account.values()),
            "by_category": list(by_category.values()),
            "by_asset": list(by_asset.values()),
        },
        "timeline": timeline,
        "items": items,
    }


@router.patch("/credit-commitments/{transaction_id}")
async def update_credit_commitment(
    transaction_id: uuid.UUID,
    data: CreditCommitmentUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    stmt = select(Transaction).where(
        Transaction.id == transaction_id,
        Transaction.workspace_id == ctx.workspace.id,
    )
    result = await session.execute(stmt)
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if data.description is not None:
        tx.description = data.description.strip()
    if data.category_id is not None:
        tx.category_id = _clean_uuid_param(data.category_id)
    if data.asset_id is not None:
        tx.asset_id = _clean_uuid_param(data.asset_id)

    # If it belongs to an installment series, propagate to sibling installments
    if tx.installment_series_id is not None:
        siblings_stmt = select(Transaction).where(
            Transaction.installment_series_id == tx.installment_series_id,
            Transaction.workspace_id == ctx.workspace.id,
        )
        siblings_res = await session.execute(siblings_stmt)
        for sibling in siblings_res.scalars():
            if data.description is not None:
                sibling.description = tx.description
            if data.category_id is not None:
                sibling.category_id = tx.category_id
            if data.asset_id is not None:
                sibling.asset_id = tx.asset_id

    await session.commit()
    await session.refresh(tx)
    return {"status": "ok", "id": str(tx.id), "description": tx.description}
