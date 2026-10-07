import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/format'
import {
  transactions as transactionsApi,
  categories as categoriesApi,
  categoryGroups as categoryGroupsApi,
} from '@/lib/api'
import { invalidateFinancialQueries } from '@/lib/invalidate-queries'
import { extractApiError } from '@/lib/api-errors'
import { CategoryIcon } from '@/components/category-icon'
import { CategorySelect } from '@/components/category-select'
import { TransactionDialog, type TransactionSavePayload } from '@/components/transaction-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  Search,
  Pencil,
  Tag,
  CheckSquare,
  Square,
  AlertCircle,
  Store,
  Layers,
  CreditCard,
  Building2,
  TrendingDown,
  X,
} from 'lucide-react'
import type { Transaction, Category, CategoryGroup, Account } from '@/types'

interface ExpenseBreakdownProps {
  accountIds?: string[]
  startDate?: string
  endDate?: string
  accountsList: Account[]
  userCurrency: string
  locale: string
}

interface PayeeNode {
  name: string
  total: number
  count: number
  percentageOfCategory: number
  transactions: Transaction[]
}

interface CategoryNode {
  id: string
  name: string
  color: string
  icon?: string
  groupName?: string
  total: number
  count: number
  percentageOfTotal: number
  payees: PayeeNode[]
  transactions: Transaction[]
}

export function ExpenseBreakdown({
  accountIds,
  startDate,
  endDate,
  accountsList,
  userCurrency,
  locale,
}: ExpenseBreakdownProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [groupBy, setGroupBy] = useState<'category' | 'group'>('category')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedPayees, setExpandedPayees] = useState<Set<string>>(new Set())
  const [showingAllTxsCategory, setShowingAllTxsCategory] = useState<string | null>(null)

  // Selection & Bulk Actions
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('')

  // Single Transaction Editing
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Fetch transactions
  const {
    data: txData,
    isLoading: txLoading,
    isError: txError,
    error: txErrorObj,
    refetch: refetchTxs,
  } = useQuery({
    queryKey: ['transactions', 'expense-breakdown', accountIds, startDate, endDate],
    queryFn: () =>
      transactionsApi.list({
        account_ids: accountIds,
        from: startDate,
        to: endDate,
        type: 'debit',
        limit: 500,
        exclude_ignored: true,
      }),
  })

  // Fetch categories & groups
  const { data: categoriesList = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const { data: categoryGroupsList = [] } = useQuery({
    queryKey: ['categoryGroups'],
    queryFn: () => categoryGroupsApi.list(),
  })

  // Lookup maps
  const categoryMap = useMemo(() => {
    return new Map<string, Category>(categoriesList.map((c) => [c.id, c]))
  }, [categoriesList])

  const groupMap = useMemo(() => {
    return new Map<string, CategoryGroup>(categoryGroupsList.map((g) => [g.id, g]))
  }, [categoryGroupsList])

  const accountMap = useMemo(() => {
    return new Map<string, Account>(accountsList.map((a) => [a.id, a]))
  }, [accountsList])

  // Single update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id: txId, ...data }: TransactionSavePayload & { id: string }) =>
      transactionsApi.update(txId, data),
    onSuccess: () => {
      invalidateFinancialQueries(queryClient)
      refetchTxs()
      setDialogOpen(false)
      setEditingTx(null)
      toast.success(t('common.saved', { defaultValue: 'Transacción actualizada' }))
    },
    onError: (error) => {
      toast.error(extractApiError(error))
    },
  })

  // Bulk categorize mutation
  const bulkCategorizeMutation = useMutation({
    mutationFn: ({ txIds, categoryId }: { txIds: string[]; categoryId: string | null }) =>
      transactionsApi.bulkCategorize(txIds, categoryId),
    onSuccess: (res) => {
      invalidateFinancialQueries(queryClient)
      refetchTxs()
      setSelectedTxIds(new Set())
      setBulkCategoryId('')
      toast.success(
        t('transactions.bulkCategorizeSuccess', {
          count: res.updated,
          defaultValue: `${res.updated} transacciones reclasificadas con éxito`,
        }),
      )
    },
    onError: (error) => {
      toast.error(extractApiError(error))
    },
  })

  // Filter raw transactions to pure expenses
  const expenseTransactions = useMemo(() => {
    if (!txData?.items) return []
    return txData.items.filter((tx) => {
      if (tx.is_ignored) return false
      // Only debits / expenses
      return tx.type === 'debit' || Number(tx.amount) < 0
    })
  }, [txData])

  // Total expense sum
  const totalExpenses = useMemo(() => {
    return expenseTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0)
  }, [expenseTransactions])

  // Grouped Categories Hierarchy
  const categoryNodes = useMemo(() => {
    if (expenseTransactions.length === 0) return []

    // Map: categoryKey -> { info, txs, payeesMap }
    const catMap = new Map<
      string,
      {
        id: string
        name: string
        color: string
        icon?: string
        groupName?: string
        txs: Transaction[]
        payees: Map<string, Transaction[]>
      }
    >()

    for (const tx of expenseTransactions) {
      const cat = tx.category_id ? categoryMap.get(tx.category_id) : null
      const group = cat?.group_id ? groupMap.get(cat.group_id) : null

      let key = ''
      let name = ''
      let color = ''
      let icon = 'circle-help'
      let groupName = group?.name || 'General'

      if (groupBy === 'group') {
        key = group ? group.id : 'no_group'
        name = group ? group.name : 'Otros / Sin Grupo'
        color = group?.color || '#6366F1'
        icon = group?.icon || 'layers'
      } else {
        key = cat ? cat.id : 'uncategorized'
        name = cat ? cat.name : 'Sin categoría'
        color = cat?.color || '#94A3B8'
        icon = cat?.icon || 'circle-help'
      }

      if (!catMap.has(key)) {
        catMap.set(key, {
          id: key,
          name,
          color,
          icon,
          groupName,
          txs: [],
          payees: new Map(),
        })
      }

      const node = catMap.get(key)!
      node.txs.push(tx)

      // Reference / Payee name
      const payeeName = tx.payee_name || tx.payee || tx.description?.trim() || 'Sin referencia'
      if (!node.payees.has(payeeName)) {
        node.payees.set(payeeName, [])
      }
      node.payees.get(payeeName)!.push(tx)
    }

    const result: CategoryNode[] = []

    for (const [, val] of catMap) {
      const catTotal = val.txs.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0)
      const catPct = totalExpenses > 0 ? (catTotal / totalExpenses) * 100 : 0

      const payeeNodes: PayeeNode[] = []
      for (const [pName, pTxs] of val.payees) {
        const pTotal = pTxs.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0)
        const pPct = catTotal > 0 ? (pTotal / catTotal) * 100 : 0
        // Sort transactions by date descending
        const sortedTxs = [...pTxs].sort((a, b) => b.date.localeCompare(a.date))
        payeeNodes.push({
          name: pName,
          total: pTotal,
          count: pTxs.length,
          percentageOfCategory: pPct,
          transactions: sortedTxs,
        })
      }

      // Sort payees by total descending
      payeeNodes.sort((a, b) => b.total - a.total)

      // Sort all category txs by date descending
      const sortedCatTxs = [...val.txs].sort((a, b) => b.date.localeCompare(a.date))

      result.push({
        id: val.id,
        name: val.name,
        color: val.color,
        icon: val.icon,
        groupName: val.groupName,
        total: catTotal,
        count: val.txs.length,
        percentageOfTotal: catPct,
        payees: payeeNodes,
        transactions: sortedCatTxs,
      })
    }

    // Sort categories by total descending
    result.sort((a, b) => b.total - a.total)
    return result
  }, [expenseTransactions, categoryMap, groupMap, totalExpenses, groupBy])

  // Filtered categories based on search query
  const filteredCategoryNodes = useMemo(() => {
    if (!searchQuery.trim()) return categoryNodes
    const q = searchQuery.toLowerCase().trim()

    return categoryNodes
      .map((cat) => {
        const catMatches = cat.name.toLowerCase().includes(q)
        const matchingPayees = cat.payees.filter((p) => {
          const payeeMatches = p.name.toLowerCase().includes(q)
          const txMatches = p.transactions.some((t) => t.description?.toLowerCase().includes(q))
          return payeeMatches || txMatches
        })

        if (catMatches) {
          return cat
        }

        if (matchingPayees.length > 0) {
          return {
            ...cat,
            payees: matchingPayees,
          }
        }

        return null
      })
      .filter((c): c is CategoryNode => c !== null)
  }, [categoryNodes, searchQuery])

  // Top metrics
  const topCategory = categoryNodes.length > 0 ? categoryNodes[0] : null
  const topPayee = useMemo(() => {
    if (expenseTransactions.length === 0) return null
    const payeeTotals = new Map<string, { total: number; count: number }>()
    for (const tx of expenseTransactions) {
      const name = tx.payee_name || tx.payee || tx.description?.trim() || 'Sin referencia'
      const cur = payeeTotals.get(name) || { total: 0, count: 0 }
      cur.total += Math.abs(Number(tx.amount))
      cur.count += 1
      payeeTotals.set(name, cur)
    }
    let best = { name: '', total: 0, count: 0 }
    for (const [name, data] of payeeTotals) {
      if (data.total > best.total) {
        best = { name, ...data }
      }
    }
    const pct = totalExpenses > 0 ? (best.total / totalExpenses) * 100 : 0
    return { ...best, percentageOfTotal: pct }
  }, [expenseTransactions, totalExpenses])

  // Selected transactions total sum
  const selectedTotalAmount = useMemo(() => {
    if (selectedTxIds.size === 0) return 0
    let sum = 0
    for (const tx of expenseTransactions) {
      if (selectedTxIds.has(tx.id)) {
        sum += Math.abs(Number(tx.amount))
      }
    }
    return sum
  }, [selectedTxIds, expenseTransactions])

  // Toggle category expanded
  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  // Toggle payee expanded
  const togglePayee = (key: string) => {
    setExpandedPayees((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Toggle single tx checkbox
  const toggleSelectTx = (txId: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev)
      if (next.has(txId)) next.delete(txId)
      else next.add(txId)
      return next
    })
  }

  // Toggle select all txs in a list
  const toggleSelectAll = (txs: Transaction[]) => {
    const allSelected = txs.every((t) => selectedTxIds.has(t.id))
    setSelectedTxIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const t of txs) next.delete(t.id)
      } else {
        for (const t of txs) next.add(t.id)
      }
      return next
    })
  }

  // Bulk categorize action
  const handleBulkCategorize = () => {
    if (selectedTxIds.size === 0 || !bulkCategoryId) return
    bulkCategorizeMutation.mutate({
      txIds: Array.from(selectedTxIds),
      categoryId: bulkCategoryId === 'none' ? null : bulkCategoryId,
    })
  }

  // Expand all / Collapse all
  const expandAll = () => {
    setExpandedCategories(new Set(categoryNodes.map((c) => c.id)))
    const allPKeys: string[] = []
    for (const c of categoryNodes) {
      for (const p of c.payees) {
        allPKeys.push(`${c.id}-${p.name}`)
      }
    }
    setExpandedPayees(new Set(allPKeys))
  }

  const collapseAll = () => {
    setExpandedCategories(new Set())
    setExpandedPayees(new Set())
    setShowingAllTxsCategory(null)
  }

  return (
    <div className="space-y-5">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Expenses */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Total de Gastos</span>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums text-rose-500">
            {txLoading ? <Skeleton className="h-7 w-28" /> : `-${formatCurrency(totalExpenses, userCurrency, locale)}`}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {expenseTransactions.length} transacciones registradas
          </p>
        </div>

        {/* Top Category */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Categoría Principal</span>
            <Tag className="h-4 w-4 text-primary" />
          </div>
          <p className="text-lg sm:text-xl font-bold tabular-nums text-foreground truncate">
            {txLoading ? <Skeleton className="h-6 w-24" /> : topCategory ? topCategory.name : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            {topCategory
              ? `${formatCurrency(topCategory.total, userCurrency, locale)} (${topCategory.percentageOfTotal.toFixed(1)}%)`
              : 'Sin datos'}
          </p>
        </div>

        {/* Top Payee / Reference */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Comercio Principal</span>
            <Store className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-lg sm:text-xl font-bold tabular-nums text-foreground truncate">
            {txLoading ? <Skeleton className="h-6 w-24" /> : topPayee ? topPayee.name : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            {topPayee
              ? `${formatCurrency(topPayee.total, userCurrency, locale)} (${topPayee.percentageOfTotal.toFixed(1)}%)`
              : 'Sin datos'}
          </p>
        </div>

        {/* Count & Coverage */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Diversificación</span>
            <Layers className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums text-foreground">
            {txLoading ? <Skeleton className="h-7 w-16" /> : `${categoryNodes.length} rubros`}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {categoryNodes.reduce((s, c) => s + c.payees.length, 0)} comercios / referencias
          </p>
        </div>
      </div>

      {/* Controls Bar: Search & Grouping & Expand */}
      <div className="bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar comercio, referencia o categoría..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* Group By Toggle */}
          <div className="flex items-center rounded-lg border border-border bg-muted/30 overflow-hidden">
            <button
              onClick={() => setGroupBy('category')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                groupBy === 'category'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              Por Categoría
            </button>
            <button
              onClick={() => setGroupBy('group')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                groupBy === 'group'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              Por Grupo
            </button>
          </div>

          {/* Expand/Collapse */}
          <Button variant="outline" size="sm" onClick={expandAll} className="h-9 text-xs">
            Expandir Todo
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll} className="h-9 text-xs text-muted-foreground">
            Colapsar
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {txLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Error state */}
      {txError && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-800 dark:text-rose-200 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{extractApiError(txErrorObj, 'Error al cargar los gastos')}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetchTxs()}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!txLoading && !txError && filteredCategoryNodes.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-base font-semibold text-foreground">No se encontraron gastos</p>
          <p className="text-xs mt-1">Prueba seleccionando otro rango de fechas o una cuenta diferente.</p>
        </div>
      )}

      {/* Categories Accordion List */}
      {!txLoading && !txError && filteredCategoryNodes.length > 0 && (
        <div className="space-y-3">
          {filteredCategoryNodes.map((cat) => {
            const isCatExpanded = expandedCategories.has(cat.id) || searchQuery.trim().length > 0
            const isShowingAll = showingAllTxsCategory === cat.id

            return (
              <div
                key={cat.id}
                className="bg-card border border-border rounded-xl shadow-sm overflow-hidden transition-all duration-200"
              >
                {/* Category Header Row */}
                <div
                  onClick={() => toggleCategory(cat.id)}
                  className="p-3.5 sm:p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors select-none"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-transform"
                    >
                      {isCatExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <CategoryIcon icon={cat.icon} color={cat.color} size="md" />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm sm:text-base text-foreground truncate">
                          {cat.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 font-normal">
                          {cat.count} {cat.count === 1 ? 'gasto' : 'gastos'}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          {cat.percentageOfTotal.toFixed(1)}%
                        </span>
                      </div>

                      {/* Visual Progress Bar */}
                      <div className="w-full max-w-xs sm:max-w-md bg-muted rounded-full h-1.5 mt-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(2, cat.percentageOfTotal))}%`,
                            backgroundColor: cat.color || '#6366F1',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="text-right pl-3">
                    <span className="text-base sm:text-lg font-bold tabular-nums text-rose-500">
                      -{formatCurrency(cat.total, userCurrency, locale)}
                    </span>
                  </div>
                </div>

                {/* Category Details when Expanded */}
                {isCatExpanded && (
                  <div className="border-t border-border/60 bg-muted/10 p-3 sm:p-4 space-y-4">
                    {/* View Switcher: Payees vs All Category Transactions */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {isShowingAll ? 'Todas las transacciones' : 'Desglose por Referencia / Comercio'}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowingAllTxsCategory(isShowingAll ? null : cat.id)
                        }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {isShowingAll ? 'Ver por comercios' : `Ver lista completa (${cat.count})`}
                      </button>
                    </div>

                    {/* View Mode 1: All transactions in Category */}
                    {isShowingAll ? (
                      <TransactionDrilldownTable
                        transactions={cat.transactions}
                        accountMap={accountMap}
                        categoryMap={categoryMap}
                        selectedTxIds={selectedTxIds}
                        onToggleTx={toggleSelectTx}
                        onToggleSelectAll={() => toggleSelectAll(cat.transactions)}
                        onEdit={(tx) => {
                          setEditingTx(tx)
                          setDialogOpen(true)
                        }}
                        userCurrency={userCurrency}
                        locale={locale}
                      />
                    ) : (
                      /* View Mode 2: Payees / References List */
                      <div className="space-y-2">
                        {cat.payees.map((payee) => {
                          const payeeKey = `${cat.id}-${payee.name}`
                          const isPayeeExpanded = expandedPayees.has(payeeKey)

                          return (
                            <div
                              key={payeeKey}
                              className="bg-card border border-border/80 rounded-lg overflow-hidden"
                            >
                              {/* Payee Header */}
                              <div
                                onClick={() => togglePayee(payeeKey)}
                                className="px-3 py-2.5 flex items-center justify-between cursor-pointer hover:bg-muted/40 transition-colors"
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <button type="button" className="text-muted-foreground">
                                    {isPayeeExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  <Store className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="text-xs sm:text-sm font-medium text-foreground truncate">
                                    {payee.name}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground shrink-0">
                                    ({payee.count} {payee.count === 1 ? 'compra' : 'compras'})
                                  </span>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                                    {payee.percentageOfCategory.toFixed(0)}% del rubro
                                  </span>
                                  <span className="text-xs sm:text-sm font-semibold tabular-nums text-rose-500">
                                    -{formatCurrency(payee.total, userCurrency, locale)}
                                  </span>
                                </div>
                              </div>

                              {/* Payee Transactions Drilldown Table */}
                              {isPayeeExpanded && (
                                <div className="border-t border-border/50 p-2 sm:p-3 bg-muted/20">
                                  <TransactionDrilldownTable
                                    transactions={payee.transactions}
                                    accountMap={accountMap}
                                    categoryMap={categoryMap}
                                    selectedTxIds={selectedTxIds}
                                    onToggleTx={toggleSelectTx}
                                    onToggleSelectAll={() => toggleSelectAll(payee.transactions)}
                                    onEdit={(tx) => {
                                      setEditingTx(tx)
                                      setDialogOpen(true)
                                    }}
                                    userCurrency={userCurrency}
                                    locale={locale}
                                  />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedTxIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border border-border shadow-2xl rounded-2xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-4 backdrop-blur-md max-w-[95vw]">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
              {selectedTxIds.size}
            </span>
            <span className="text-xs sm:text-sm font-medium text-foreground">
              seleccionadas
            </span>
            <span className="text-xs text-rose-500 font-mono font-semibold">
              (-{formatCurrency(selectedTotalAmount, userCurrency, locale)})
            </span>
          </div>

          <div className="h-5 w-px bg-border hidden sm:block" />

          {/* Category Select to Reclassify */}
          <div className="w-48 sm:w-60">
            <CategorySelect
              value={bulkCategoryId}
              onChange={setBulkCategoryId}
              categories={categoriesList}
              groups={categoryGroupsList}
              placeholder="Reclasificar a..."
              allowNone
            />
          </div>

          <Button
            size="sm"
            disabled={!bulkCategoryId || bulkCategorizeMutation.isPending}
            onClick={handleBulkCategorize}
            className="h-9 px-4 text-xs font-semibold gap-1.5"
          >
            {bulkCategorizeMutation.isPending ? 'Guardando...' : 'Reclasificar'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedTxIds(new Set())}
            className="h-9 text-xs text-muted-foreground hover:text-foreground"
          >
            Deseleccionar
          </Button>
        </div>
      )}

      {/* Edit Transaction Dialog */}
      <TransactionDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false)
          setEditingTx(null)
        }}
        transaction={editingTx}
        categories={categoriesList}
        categoryGroups={categoryGroupsList}
        accounts={accountsList}
        onSave={(data) => {
          if (editingTx) {
            updateMutation.mutate({ id: editingTx.id, ...data })
          }
        }}
        loading={updateMutation.isPending}
        error={null}
      />
    </div>
  )
}

/** Internal Drill-down Transaction Table */
interface DrilldownTableProps {
  transactions: Transaction[]
  accountMap: Map<string, Account>
  categoryMap: Map<string, Category>
  selectedTxIds: Set<string>
  onToggleTx: (id: string) => void
  onToggleSelectAll: () => void
  onEdit: (tx: Transaction) => void
  userCurrency: string
  locale: string
}

function TransactionDrilldownTable({
  transactions,
  accountMap,
  categoryMap,
  selectedTxIds,
  onToggleTx,
  onToggleSelectAll,
  onEdit,
  userCurrency,
  locale,
}: DrilldownTableProps) {
  const allSelected = transactions.length > 0 && transactions.every((t) => selectedTxIds.has(t.id))

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-xs text-left">
        <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border select-none">
          <tr>
            <th className="py-2.5 px-3 w-8">
              <button
                type="button"
                onClick={onToggleSelectAll}
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center"
              >
                {allSelected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
              </button>
            </th>
            <th className="py-2.5 px-3">Fecha</th>
            <th className="py-2.5 px-3">Comercio / Descripción</th>
            <th className="py-2.5 px-3">Cuenta</th>
            <th className="py-2.5 px-3">Categoría Actual</th>
            <th className="py-2.5 px-3 text-right">Monto</th>
            <th className="py-2.5 px-3 w-12 text-center">Editar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {transactions.map((tx) => {
            const isSelected = selectedTxIds.has(tx.id)
            const account = accountMap.get(tx.account_id || '')
            const category = tx.category_id ? categoryMap.get(tx.category_id) : null

            return (
              <tr
                key={tx.id}
                className={`hover:bg-muted/30 transition-colors ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
              >
                {/* Checkbox */}
                <td className="py-2.5 px-3">
                  <button
                    type="button"
                    onClick={() => onToggleTx(tx.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center"
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </td>

                {/* Date */}
                <td className="py-2.5 px-3 tabular-nums font-mono text-muted-foreground whitespace-nowrap">
                  {tx.date}
                </td>

                {/* Description */}
                <td className="py-2.5 px-3 font-medium text-foreground max-w-[220px] truncate">
                  {tx.description}
                  {tx.notes && (
                    <span className="block text-[10px] text-muted-foreground font-normal truncate">
                      {tx.notes}
                    </span>
                  )}
                </td>

                {/* Account Badge */}
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <Badge
                    variant="outline"
                    className="text-[10px] py-0 px-1.5 h-4 font-normal gap-1 border-border/80"
                  >
                    {account?.type === 'credit_card' ? (
                      <CreditCard className="h-3 w-3 text-rose-500" />
                    ) : (
                      <Building2 className="h-3 w-3 text-emerald-500" />
                    )}
                    {account?.name || 'Cuenta'}
                  </Badge>
                </td>

                {/* Category */}
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <CategoryIcon icon={category?.icon} color={category?.color} size="xs" />
                    <span className="text-muted-foreground text-[11px]">
                      {category?.name || 'Sin categoría'}
                    </span>
                  </div>
                </td>

                {/* Amount */}
                <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-rose-500 whitespace-nowrap">
                  -{formatCurrency(Math.abs(Number(tx.amount)), tx.currency || userCurrency, locale)}
                </td>

                {/* Action: Edit */}
                <td className="py-2.5 px-3 text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(tx)}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    title="Editar transacción"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
