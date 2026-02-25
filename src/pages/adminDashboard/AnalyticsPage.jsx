import React, { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';

const COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#7c3aed', '#ef4444', '#14b8a6', '#f97316'];

const parsePrice = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatNaira = (amount) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount);

const AnalyticsPage = ({ vendors = [] }) => {
  const analytics = useMemo(() => {
    const categoryCount = {};
    const priceBuckets = {
      '0 - 100k': 0,
      '100k - 500k': 0,
      '500k+': 0,
    };

    const vendorPerformance = vendors
      .map((vendor) => ({
        name: vendor.vendorName || vendor.vendorId || 'Unknown',
        clicks: vendor.whatsappClicks || 0,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    let totalInventoryValue = 0;
    let totalViews = 0;

    vendors.forEach((vendor) => {
      totalViews += vendor.viewCount || 0;
      (vendor.products || []).forEach((product) => {
        const category = product.Category || 'Others';
        categoryCount[category] = (categoryCount[category] || 0) + 1;

        const price = parsePrice(product['Regular price']);
        totalInventoryValue += price;

        if (price <= 100000) {
          priceBuckets['0 - 100k'] += 1;
        } else if (price <= 500000) {
          priceBuckets['100k - 500k'] += 1;
        } else {
          priceBuckets['500k+'] += 1;
        }
      });
    });

    const categoryDistribution = Object.entries(categoryCount).map(([name, value]) => ({
      name,
      value,
    }));

    const priceHistogram = Object.entries(priceBuckets).map(([range, count]) => ({
      range,
      count,
    }));

    return {
      totalInventoryValue,
      totalViews,
      categoryDistribution,
      priceHistogram,
      vendorPerformance,
    };
  }, [vendors]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
          <p className="text-sm text-gray-500">Total Platform Inventory Value</p>
          <p className="text-3xl font-bold text-[#1A1C23] mt-2">{formatNaira(analytics.totalInventoryValue)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
          <p className="text-sm text-gray-500">Total Platform Views</p>
          <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalViews}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm h-[380px]">
          <h3 className="text-lg font-bold text-[#1A1C23] mb-4">Category Distribution</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={analytics.categoryDistribution}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={120}
                label
              >
                {analytics.categoryDistribution.map((entry, index) => (
                  <Cell key={`cell-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm h-[380px]">
          <h3 className="text-lg font-bold text-[#1A1C23] mb-4">Price Range Histogram</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={analytics.priceHistogram}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm h-[420px]">
        <h3 className="text-lg font-bold text-[#1A1C23] mb-4">Top 10 Vendors by WhatsApp Clicks</h3>
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={analytics.vendorPerformance} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={140} />
            <Tooltip />
            <Bar dataKey="clicks" fill="#16a34a" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default AnalyticsPage;
