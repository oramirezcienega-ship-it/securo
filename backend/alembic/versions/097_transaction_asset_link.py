"""add asset_id and asset_action to transactions

Revision ID: 097
Revises: 096
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "097"
down_revision: Union[str, None] = "096"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_transactions_asset_id",
        "transactions",
        ["asset_id"],
    )
    op.add_column(
        "transactions",
        sa.Column(
            "asset_action",
            sa.String(length=20),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("transactions", "asset_action")
    op.drop_index("ix_transactions_asset_id", table_name="transactions")
    op.drop_column("transactions", "asset_id")
