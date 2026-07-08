import RankedLeaderboard from './RankedLeaderboard.jsx';

export default function CompanyLeaderboard({ data, totalCompanies, onClick, limit = 10, insight }) {
  return (
    <RankedLeaderboard
      data={data}
      totalItems={totalCompanies}
      itemLabel="companies"
      onClick={onClick}
      limit={limit}
      insight={insight}
    />
  );
}
