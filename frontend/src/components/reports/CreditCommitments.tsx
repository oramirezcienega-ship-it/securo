import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  CreditCard,
  Building,
  TrendingDown,
  Calendar,
  Clock,
  Search,
  Pencil,
  Layers,
} from 'lucide-react'
import { reports, categories as categoriesApi, assets as assetsApi } from '@/lib/api'
import { formatCurrency } from '@/lib/format'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { CategoryIcon } from '@/components/category-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { CreditCommitmentItem, Asset, Category } from '@/types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

export function CreditCommitments() {
  const { t } = useTranslation()
  const locale = useDisplayLocale()
  const { privacyMode, MASK } = usePrivacyMode()
  const queryClient = useQueryClient()

  // Filters state
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<string>('all')
  const [selectedAssetFilter, setSelectedAssetFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null)

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<CreditCommitmentItem | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [editCategoryId, setEditCategoryId] = useState<string>('none')
  const [editAssetId, setEditAssetId] = useState<string>('none')

  // Query Credit Commitments
  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      'reports',
      'credit-commitments',
      selectedAccountFilter !== 'all' ? selectedAccountFilter : undefined,
      selectedAssetFilter !== 'all' ? selectedAssetFilter : undefined,
    ],
    queryFn: () =>
      reports.creditCommitments({
        account_id: selectedAccountFilter !== 'all' ? selectedAccountFilter : undefined,
        asset_id: selectedAssetFilter !== 'all' ? selectedAssetFilter : undefined,
      }),
  })

  // Query Categories & Assets for editing
  const { data: categoriesList = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  const { data: assetsList = [] } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(false),
  })

  // Update Mutation
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      description,
      categoryId,
      assetId,
    }: {
      id: string
      description: string
      categoryId: string | null
      assetId: string | null
    }) =>
      reports.updateCreditCommitment(id, {
        description,
        category_id: categoryId,
        asset_id: assetId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'credit-commitments'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      toast.success(t('common.saved', 'Compromiso actualizado con éxito'))
      setEditingItem(null)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || t('common.error', 'Error al actualizar'))
    },
  })

  const openEditModal = (item: CreditCommitmentItem) => {
    setEditingItem(item)
    setEditDescription(item.description)
    setEditCategoryId(item.category_id || 'none')
    setEditAssetId(item.asset_id || 'none')
  }

  const handleSaveEdit = () => {
    if (!editingItem) return
    updateMutation.mutate({
      id: editingItem.id,
      description: editDescription.trim() || editingItem.description,
      categoryId: editCategoryId !== 'none' ? editCategoryId : null,
      assetId: editAssetId !== 'none' ? editAssetId : null,
    })
  }

  // Filtered Items
  const filteredItems = useMemo(() => {
    if (!data?.items) return []
    return data.items.filter((item) => {
      if (statusFilter === 'active' && item.remaining_months === 0) return false
      if (statusFilter === 'completed' && item.remaining_months > 0) return false

      if (selectedAssetFilter !== 'all') {
        if (selectedAssetFilter === 'unlinked' && item.asset_id) return false
        if (selectedAssetFilter !== 'unlinked' && item.asset_id !== selectedAssetFilter) return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchDesc = item.description.toLowerCase().includes(q)
        const matchOrig = item.original_description.toLowerCase().includes(q)
        const matchAcct = item.account_name.toLowerCase().includes(q)
        const matchCat = (item.category_name || '').toLowerCase().includes(q)
        const matchAsset = (item.asset_name || '').toLowerCase().includes(q)
        if (!matchDesc && !matchOrig && !matchAcct && !matchCat && !matchAsset) return false
      }

      return true
    })
  }, [data?.items, statusFilter, selectedAssetFilter, searchQuery])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  const summary = data?.summary
  const timeline = data?.timeline || []

  const totalPaidPercent =
    summary && summary.total_initial > 0
      ? Math.round((summary.total_paid / summary.total_initial) * 100)
      : 0

  const activeTimelineMonth =
    selectedMonthIndex !== null && timeline[selectedMonthIndex]
      ? timeline[selectedMonthIndex]
      : null

  return (
    <div className="space-y-8">
      {/* Header and Account Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {t('reports.creditsTitle', 'Créditos y Compromisos de Tarjetas')}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {t(
              'reports.creditsSubtitle',
              'Monitoreo de compras a meses sin intereses, remanentes pendientes y proyección de pagos futuros.',
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Select value={selectedAccountFilter} onValueChange={setSelectedAccountFilter}>
            <SelectTrigger className="w-[180px] h-9 text-xs sm:text-sm bg-card border-border">
              <SelectValue placeholder={t('reports.allCards', 'Todas las tarjetas')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports.allCards', 'Todas las tarjetas')}</SelectItem>
              {summary?.by_account.map((acc) => (
                <SelectItem key={acc.account_id} value={acc.account_id}>
                  {acc.account_name} ({acc.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('common.refresh', 'Actualizar')}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Remaining Debt */}
        <div className="bg-card rounded-xl border border-border p-4.5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('reports.totalRemaining', 'Deuda Remanente')}
            </span>
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
              <TrendingDown size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground tracking-tight">
            {privacyMode ? MASK : formatCurrency(summary?.total_remaining ?? 0, 'MXN', locale)}
          </p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{t('reports.paid', 'Pagado')}: {privacyMode ? MASK : formatCurrency(summary?.total_paid ?? 0, 'MXN', locale)}</span>
              <span>{totalPaidPercent}%</span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, totalPaidPercent)}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground/80">
              {t('reports.initialTotal', 'Total original')}: {privacyMode ? MASK : formatCurrency(summary?.total_initial ?? 0, 'MXN', locale)}
            </p>
          </div>
        </div>

        {/* Next Month Payment */}
        <div className="bg-card rounded-xl border border-border p-4.5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('reports.monthlyNextMonth', 'Compromiso Próximo Mes')}
            </span>
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
              <Calendar size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-rose-500 tracking-tight">
            {privacyMode ? MASK : formatCurrency(summary?.monthly_current_month ?? 0, 'MXN', locale)}
          </p>
          <p className="text-xs text-muted-foreground">
            {summary?.active_count ?? 0} {t('reports.activePurchases', 'compras activas a pagar')}
          </p>
        </div>

        {/* Max Remaining Months */}
        <div className="bg-card rounded-xl border border-border p-4.5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('reports.maxTerm', 'Plazo de Liquidación')}
            </span>
            <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-500">
              <Clock size={16} />
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground tracking-tight">
            {summary?.max_remaining_months ?? 0} {t('reports.monthsUnit', 'meses')}
          </p>
          <p className="text-xs text-muted-foreground">
            {timeline.length > 0
              ? t('reports.concludesIn', 'Se liquida en {{date}}', {
                  date: timeline[timeline.length - 1]?.month_label,
                })
              : ''}
          </p>
        </div>

        {/* Distribution by Card */}
        <div className="bg-card rounded-xl border border-border p-4.5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('reports.cardDistribution', 'Distribución por Tarjeta')}
            </span>
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
              <Layers size={16} />
            </span>
          </div>
          <div className="space-y-1 pt-0.5">
            {summary?.by_account.map((acc) => (
              <div key={acc.account_id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[130px]" title={acc.account_name}>
                  {acc.account_name}
                </span>
                <span className="font-semibold text-foreground">
                  {privacyMode ? MASK : formatCurrency(acc.total_remaining, 'MXN', locale)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Projection Timeline Chart */}
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground text-sm sm:text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              {t('reports.futureProjectionTitle', 'Proyección de Compromisos Mes a Mes')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'reports.futureProjectionDesc',
                'Visualiza cómo disminuyen tus pagos mensuales a medida que se liquidan tus compras a plazos.',
              )}
            </p>
          </div>
          {activeTimelineMonth && (
            <div className="flex items-center gap-2 bg-muted/60 px-3 py-1 rounded-lg text-xs">
              <span className="font-medium text-foreground">{activeTimelineMonth.month_label}:</span>
              <span className="font-bold text-primary">
                {privacyMode ? MASK : formatCurrency(activeTimelineMonth.total_committed, 'MXN', locale)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedMonthIndex(null)}
                className="text-muted-foreground hover:text-foreground ml-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="h-64 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={timeline}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              onClick={(e) => {
                if (e && typeof e.activeTooltipIndex === 'number') {
                  setSelectedMonthIndex(e.activeTooltipIndex)
                }
              }}
            >
              <XAxis
                dataKey="month_label"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload
                    return (
                      <div className="rounded-lg border border-border bg-card p-2.5 shadow-lg text-xs space-y-1">
                        <p className="font-bold text-foreground">{item.month_label}</p>
                        <p className="text-primary font-semibold">
                          {privacyMode ? MASK : formatCurrency(item.total_committed, 'MXN', locale)}
                        </p>
                        <p className="text-muted-foreground text-[10px]">
                          {item.active_items_count} {t('reports.purchasesIncluded', 'compras activas')}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 italic">
                          {t('reports.clickToInspect', 'Haz clic para ver el desglose')}
                        </p>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Bar dataKey="total_committed" radius={[4, 4, 0, 0]}>
                {timeline.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      selectedMonthIndex === index
                        ? 'var(--primary)'
                        : index === 0
                          ? '#F43F5E' // Rojo para el mes inmediato
                          : index < 4
                            ? '#F59E0B' // Ámbar para los meses 2 a 4
                            : '#10B981' // Verde para meses lejanos
                    }
                    className="cursor-pointer transition-opacity hover:opacity-80"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Selected Month Breakdown Drill-down */}
        {activeTimelineMonth && (
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">
                {t('reports.breakdownFor', 'Desglose para {{month}}:', { month: activeTimelineMonth.month_label })}
              </span>
              <span className="text-muted-foreground">
                {activeTimelineMonth.items.length} {t('reports.activeItems', 'conceptos')}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1 max-h-56 overflow-y-auto">
              {activeTimelineMonth.items.map((it, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-medium text-foreground truncate" title={it.description}>
                      {it.description}
                    </span>
                    <span className="font-semibold text-foreground shrink-0">
                      {privacyMode ? MASK : formatCurrency(it.monthly_amount, 'MXN', locale)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1.5">
                    <span>{it.account_name}</span>
                    <span className="bg-background px-1.5 py-0.5 rounded border border-border/60">
                      {it.installment}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Commitments Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {/* Table Filter Controls */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-foreground text-sm sm:text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                {t('reports.commitmentsListTitle', 'Listado de Compras y Deudas a Meses')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {filteredItems.length} {t('reports.matchingCommitments', 'compromisos encontrados')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('reports.searchCommitments', 'Buscar deuda, comercio...')}
                  className="pl-8 h-8 text-xs bg-background"
                />
              </div>

              <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
                <SelectTrigger className="w-[125px] h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('reports.statusActive', 'Activas')}</SelectItem>
                  <SelectItem value="completed">{t('reports.statusCompleted', 'Liquidadas')}</SelectItem>
                  <SelectItem value="all">{t('reports.statusAll', 'Todas')}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedAssetFilter} onValueChange={setSelectedAssetFilter}>
                <SelectTrigger className="w-[145px] h-8 text-xs bg-background">
                  <SelectValue placeholder={t('reports.filterByAsset', 'Filtrar por Activo')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('reports.allAssets', 'Todos los activos')}</SelectItem>
                  <SelectItem value="unlinked">{t('reports.unlinkedAsset', 'Sin activo')}</SelectItem>
                  {assetsList.map((ast) => (
                    <SelectItem key={ast.id} value={ast.id}>
                      {ast.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Table Content */}
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            {t('reports.noCommitmentsFound', 'No se encontraron compromisos con los filtros seleccionados.')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3">{t('reports.colCard', 'Tarjeta')}</th>
                  <th className="px-4 py-3">{t('reports.colConcept', 'Deuda / Concepto')}</th>
                  <th className="px-4 py-3 text-right">{t('reports.colMonthly', 'Mensualidad')}</th>
                  <th className="px-4 py-3 text-center">{t('reports.colProgress', 'Progreso')}</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">{t('reports.colInitial', 'Original')}</th>
                  <th className="px-4 py-3 text-right hidden md:table-cell">{t('reports.colPaid', 'Pagado')}</th>
                  <th className="px-4 py-3 text-right">{t('reports.colRemaining', 'Pendiente')}</th>
                  <th className="px-4 py-3 hidden lg:table-cell">{t('reports.colCategory', 'Categoría')}</th>
                  <th className="px-4 py-3">{t('reports.colAsset', 'Activo')}</th>
                  <th className="px-4 py-3 text-center">{t('common.actions', 'Acciones')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.map((item) => {
                  const isCompleted = item.remaining_months === 0
                  const isNu = item.account_name.toLowerCase().includes('nu')
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* Card */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isNu
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          <CreditCard size={11} />
                          {item.account_name.split(' ')[0]}
                        </span>
                      </td>

                      {/* Concept & Description */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground truncate" title={item.description}>
                            {item.description}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            title={t('common.edit', 'Editar nombre')}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                        {item.original_description !== item.description && (
                          <span className="text-[10px] text-muted-foreground block truncate">
                            {item.original_description}
                          </span>
                        )}
                      </td>

                      {/* Monthly Amount */}
                      <td className="px-4 py-3 text-right font-medium text-foreground whitespace-nowrap">
                        {privacyMode ? MASK : formatCurrency(item.monthly_amount, 'MXN', locale)}
                      </td>

                      {/* Progress */}
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <div className="inline-flex flex-col items-center gap-1">
                          <span className="text-[11px] font-medium text-foreground">
                            {item.installment_number} / {item.total_installments}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full ${isCompleted ? 'bg-emerald-500' : 'bg-primary'}`}
                              style={{
                                width: `${Math.round((item.installment_number / item.total_installments) * 100)}%`,
                              }}
                            />
                          </div>
                          {!isCompleted ? (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              {t('reports.remMonthsBadge', 'Faltan {{count}} m', { count: item.remaining_months })}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                              {t('reports.liquidated', 'Liquidado')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Initial Total */}
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                        {privacyMode ? MASK : formatCurrency(item.total_initial, 'MXN', locale)}
                      </td>

                      {/* Paid Amount */}
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap hidden md:table-cell">
                        {privacyMode ? MASK : formatCurrency(item.total_paid, 'MXN', locale)}
                      </td>

                      {/* Remaining Debt */}
                      <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                        <span className={item.remaining_amount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'}>
                          {privacyMode ? MASK : formatCurrency(item.remaining_amount, 'MXN', locale)}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3 whitespace-nowrap hidden lg:table-cell">
                        {item.category_name ? (
                          <div className="flex items-center gap-1.5">
                            <CategoryIcon
                              icon={item.category_icon}
                              color={item.category_color}
                              size="xs"
                            />
                            <span className="text-xs text-foreground">{item.category_name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">—</span>
                        )}
                      </td>

                      {/* Asset Link */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.asset_name ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40">
                            <Building size={11} />
                            {item.asset_name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                          >
                            + {t('reports.linkAsset', 'Vincular')}
                          </button>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(item)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Pencil size={13} className="mr-1" />
                          {t('common.edit', 'Editar')}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Commitment Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-4 w-4 text-primary" />
              {t('reports.editCommitmentTitle', 'Editar / Identificar Deuda')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t(
                'reports.editCommitmentDesc',
                'Personaliza el nombre de la compra, clasifícala en una categoría y vincúlala a uno de tus activos (ej. Terreno, Casa, etc.).',
              )}
            </DialogDescription>
          </DialogHeader>

          {editingItem && (
            <div className="space-y-4 py-2">
              {/* Card & Details Info Banner */}
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('reports.card', 'Tarjeta')}:</span>
                  <span className="font-semibold">{editingItem.account_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('reports.originalConcept', 'Concepto bancario')}:</span>
                  <span className="font-medium truncate max-w-[200px]" title={editingItem.original_description}>
                    {editingItem.original_description}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('reports.termsInfo', 'Mensualidad / Plazo')}:</span>
                  <span className="font-semibold text-primary">
                    {formatCurrency(editingItem.monthly_amount, 'MXN', locale)}/mes ({editingItem.installment_number}/{editingItem.total_installments} pagos)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('reports.remainingToPay', 'Saldo pendiente')}:</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    {formatCurrency(editingItem.remaining_amount, 'MXN', locale)} ({editingItem.remaining_months} meses restantes)
                  </span>
                </div>
              </div>

              {/* Editable Name */}
              <div className="space-y-1.5">
                <Label htmlFor="debt-name" className="text-xs">
                  {t('reports.debtNameLabel', 'Nombre o Concepto Reconocible')}
                </Label>
                <Input
                  id="debt-name"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Ej. Material Construrama Terreno, MacBook, Llantas..."
                  className="text-xs h-9"
                />
              </div>

              {/* Category Select */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('reports.category', 'Categoría')}</Label>
                <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder={t('transactions.selectCategory', 'Seleccionar categoría')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('transactions.uncategorized', 'Sin categoría')}</SelectItem>
                    {categoriesList.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <div className="flex items-center gap-2">
                          <CategoryIcon icon={cat.icon} color={cat.color} size="xs" />
                          <span>{cat.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Asset Link Select */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center justify-between">
                  <span>{t('reports.linkToAsset', 'Vincular a Activo')}</span>
                  <span className="text-[10px] text-muted-foreground">
                    (Acumula costos a tu activo)
                  </span>
                </Label>
                <Select value={editAssetId} onValueChange={setEditAssetId}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder={t('reports.noAssetLinked', 'Sin activo vinculado')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('reports.noAssetLinked', 'Ninguno / Sin activo')}</SelectItem>
                    {assetsList.map((ast) => (
                      <SelectItem key={ast.id} value={ast.id}>
                        <div className="flex items-center gap-2">
                          <Building size={13} className="text-muted-foreground" />
                          <span>{ast.name}</span>
                          <span className="text-[10px] text-muted-foreground">({ast.type})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingItem(null)}
              className="text-xs"
            >
              {t('common.cancel', 'Cancelar')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              className="text-xs"
            >
              {updateMutation.isPending ? t('common.saving', 'Guardando...') : t('common.save', 'Guardar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
