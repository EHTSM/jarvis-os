import { useEffect, useState } from "react";
import { getStats } from "../api";

export default function Dashboard() {
  const [stats, setStats] = useState({});

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const res = await getStats();
    setStats(res);
  };

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>

      <p>Total Leads: {stats.totalLeads}</p>
      <p>Revenue: ₹{stats.revenue}</p>
      <p>Conversion: {stats.conversionRate}</p>
    </div>
  );
}