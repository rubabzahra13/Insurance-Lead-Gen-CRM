import { Outlet } from 'react-router-dom';
import { useDesk } from '../context/DeskContext.jsx';
import AppSidebar from '../components/desk/AppSidebar.jsx';
import DeskHeader from '../components/desk/DeskHeader.jsx';
import SearchDialog from '../components/desk/SearchDialog.jsx';

export default function AppLayout() {
  const {
    searchOpen,
    setSearchOpen,
    mergeIncomingLeads,
    handleSearchComplete,
    onLeadsPage,
  } = useDesk();

  return (
    <div className="desk-app flex h-screen flex-col overflow-hidden">
      <DeskHeader onNewSearch={() => setSearchOpen(true)} />

      <div className="desk-body flex min-h-0 flex-1">
        <AppSidebar />

        <div className="desk-workspace">
          <main className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${onLeadsPage ? 'desk-main' : 'dash-main'}`}>
            <Outlet />
          </main>
        </div>
      </div>

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onLeadsPreview={mergeIncomingLeads}
        onComplete={handleSearchComplete}
      />
    </div>
  );
}
