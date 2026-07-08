import { useMemo, useState } from 'react';
import { kbExportUrl } from '../lib/api.js';
import { isPersistedLead } from '../lib/lead-utils.js';
import { sortDuplicates } from '../lib/lead-sort.js';
import { useDesk } from '../context/DeskContext.jsx';
import BulkActionBar from '../components/desk/BulkActionBar.jsx';
import DuplicateInspector from '../components/desk/DuplicateInspector.jsx';
import DuplicateQueueTable from '../components/desk/DuplicateQueueTable.jsx';
import InspectorPanel from '../components/desk/InspectorPanel.jsx';
import LeadDataTable from '../components/desk/LeadDataTable.jsx';
import LeadsToolbar from '../components/desk/LeadsToolbar.jsx';
import PaginationBar from '../components/desk/PaginationBar.jsx';
import DeskStatStrip, { buildHeaderStats } from '../components/desk/DeskStatStrip.jsx';

const VIEW_TITLES = {
  all: 'All leads',
  new: 'New this week',
  starred: 'Starred leads',
  review: 'Duplicate review',
};

export default function LeadsPage() {
  const desk = useDesk();
  const {
    view,
    filters,
    searchInput,
    setSearchInput,
    page,
    setPage,
    sortValue,
    handleSortChange,
    leadsData,
    facets,
    savedViews,
    dashboard,
    duplicates,
    selectedLead,
    setSelectedLead,
    selectedReview,
    selectReview,
    closeReviewInspector,
    selectedIds,
    selectionScope,
    loading,
    refreshing,
    loadError,
    resolving,
    hasActiveFilters,
    activeRunLabel,
    pendingCount,
    PAGE_SIZE,
    handleRunSelect,
    handleClearFilters,
    handleFilterChange,
    handleUpdate,
    handleDelete,
    handleSaveView,
    handleApplySavedView,
    handleDeleteSavedView,
    handleResolve,
    handleToggleSelect,
    handleToggleSelectAll,
    handleSelectAllMatching,
    handleClearSelection,
    handleBulk,
    pageRange,
  } = desk;

  const [duplicateSort, setDuplicateSort] = useState('name:asc');
  const sortedDuplicates = useMemo(
    () => sortDuplicates(duplicates, duplicateSort),
    [duplicates, duplicateSort],
  );

  const exportParams = useMemo(
    () => ({
      q: filters.q,
      company: filters.company,
      location: filters.location,
      title: filters.title,
      tag: filters.tag,
      runId: filters.runId,
      starred: view === 'starred' ? '1' : undefined,
      createdSince: view === 'new' ? new Date(Date.now() - 7 * 86400000).toISOString() : undefined,
    }),
    [filters, view],
  );

  const totalPages = Math.max(1, Math.ceil(leadsData.total / PAGE_SIZE));
  const range = pageRange(page, PAGE_SIZE, leadsData.total);
  const tableLoading = loading && leadsData.leads.length === 0;
  const pagePersistedCount = useMemo(
    () => leadsData.leads.filter(isPersistedLead).length,
    [leadsData.leads],
  );
  const selectedCount = selectionScope === 'all' ? leadsData.total : selectedIds.size;

  const headerStats = useMemo(
    () =>
      buildHeaderStats({
        view,
        matchingTotal: view === 'review' ? duplicates.length : leadsData.total,
        libraryTotal: dashboard?.stats?.totalLeads ?? 0,
        starredCount: dashboard?.stats?.starredCount ?? 0,
        newThisWeek: dashboard?.stats?.newThisWeek ?? 0,
        pendingReview: pendingCount,
        hasActiveFilters,
      }),
    [
      view,
      duplicates.length,
      leadsData.total,
      dashboard?.stats?.totalLeads,
      dashboard?.stats?.starredCount,
      dashboard?.stats?.newThisWeek,
      pendingCount,
      hasActiveFilters,
    ],
  );

  return (
    <div className="leads-page">
      <div className="desk-main-pane">
      <LeadsToolbar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        exportUrl={kbExportUrl(exportParams)}
        facets={facets}
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        onSaveView={handleSaveView}
        hasActiveFilters={hasActiveFilters}
        savedViews={savedViews}
        activeRunId={view === 'all' ? filters.runId : ''}
        activeRunLabel={view === 'all' ? activeRunLabel : ''}
        onApplySavedView={handleApplySavedView}
        onDeleteSavedView={handleDeleteSavedView}
        sortValue={view === 'review' ? duplicateSort : sortValue}
        onSortChange={view === 'review' ? setDuplicateSort : handleSortChange}
        sortVariant={view === 'review' ? 'review' : 'leads'}
      />

      <div className="desk-main-header">
        <h1 className="desk-heading desk-main-title">{VIEW_TITLES[view] ?? 'Leads'}</h1>
        <DeskStatStrip items={headerStats} refreshing={refreshing} />
        {view !== 'review' && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            range={range}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </div>

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[var(--desk-text)] text-red-800">
          {loadError}
        </div>
      )}

      {view !== 'review' && (
        <BulkActionBar
          selectedCount={selectedCount}
          totalCount={leadsData.total}
          pageCount={pagePersistedCount}
          scope={selectionScope}
          onSelectAllMatching={handleSelectAllMatching}
          onStar={() => handleBulk('star', exportParams)}
          onUnstar={() => handleBulk('unstar', exportParams)}
          onDelete={() => handleBulk('delete', exportParams)}
          onClear={handleClearSelection}
        />
      )}

      {view === 'review' ? (
        <DuplicateQueueTable
          reviews={sortedDuplicates}
          selectedId={selectedReview?.id}
          onSelect={selectReview}
        />
      ) : (
        <LeadDataTable
          leads={leadsData.leads}
          selectedId={selectedLead?.id}
          selectedIds={selectedIds}
          selectionScope={selectionScope}
          onSelect={setSelectedLead}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          onToggleStar={(lead) => handleUpdate(lead.id, { starred: !lead.starred })}
          onEdit={setSelectedLead}
          onDelete={(lead) => isPersistedLead(lead) && handleDelete(lead.id)}
          loading={tableLoading}
        />
      )}

      </div>

      {view === 'review' ? (
        selectedReview && (
          <DuplicateInspector
            review={selectedReview}
            onResolve={handleResolve}
            onClose={closeReviewInspector}
            resolving={resolving}
          />
        )
      ) : (
        selectedLead && (
          <InspectorPanel
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onFilterByRun={handleRunSelect}
          />
        )
      )}
    </div>
  );
}
