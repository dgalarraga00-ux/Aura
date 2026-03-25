import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

interface DayBucket {
  date: string;
  count: number;
}

/**
 * Groups an array of ISO timestamp strings into daily buckets for the last N days.
 */
function bucketByDay(timestamps: string[], days: number): DayBucket[] {
  const now = new Date();
  const buckets: Map<string, number> = new Map();

  // Initialize all days with 0
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const ts of timestamps) {
    const day = ts.slice(0, 10);
    if (buckets.has(day)) {
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  if (!userData || userData.role === 'tenant_operator') {
    redirect('/dashboard/conversations');
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString();

  type MessageAnalyticsRow = {
    created_at: string;
    direction: string;
    status: string;
    llm_response: string | null;
  };

  type HandoffConvRow = {
    escalated_at: string | null;
  };

  // Fetch all inbound messages in the last 30 days
  const { data: rawMessages } = await supabase
    .from('messages')
    .select('created_at, direction, status, llm_response')
    .gte('created_at', since)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: true });

  // Fetch all handoffs in the last 30 days
  // We approximate handoffs by counting escalated conversations within the range
  const { data: rawHandoffConvs } = await supabase
    .from('conversations')
    .select('escalated_at')
    .not('escalated_at', 'is', null)
    .gte('escalated_at', since);

  const allMessages = (rawMessages as MessageAnalyticsRow[] | null) ?? [];
  const allHandoffs = (rawHandoffConvs as HandoffConvRow[] | null) ?? [];

  // Metrics
  const totalMessages = allMessages.length;
  const totalHandoffs = allHandoffs.length;

  // Bot resolution rate = messages with llm_response (bot answered) / total inbound
  const botAnswered = allMessages.filter((m) => m.llm_response != null).length;
  const resolutionRate =
    totalMessages > 0 ? ((botAnswered / totalMessages) * 100).toFixed(1) : '0.0';

  // Daily buckets
  const messageBuckets = bucketByDay(
    allMessages.map((m) => m.created_at),
    30
  );
  const handoffBuckets = bucketByDay(
    allHandoffs.map((h) => h.escalated_at!),
    30
  );

  const maxMsgCount = Math.max(...messageBuckets.map((b) => b.count), 1);
  const maxHoCount = Math.max(...handoffBuckets.map((b) => b.count), 1);

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Analytics</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium mb-1">
            Total Messages (30d)
          </p>
          <p className="text-3xl font-bold text-gray-900">{totalMessages}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium mb-1">
            Handoffs (30d)
          </p>
          <p className="text-3xl font-bold text-gray-900">{totalHandoffs}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase font-medium mb-1">
            Bot Resolution Rate
          </p>
          <p className="text-3xl font-bold text-gray-900">{resolutionRate}%</p>
        </div>
      </div>

      {/* Messages per day chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Messages per Day (last 30 days)</h2>
        <div className="flex items-end gap-1 h-32">
          {messageBuckets.map((bucket) => (
            <div key={bucket.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-blue-500 rounded-t"
                style={{ height: `${(bucket.count / maxMsgCount) * 100}%`, minHeight: '2px' }}
                title={`${bucket.date}: ${bucket.count}`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{messageBuckets[0]?.date}</span>
          <span>{messageBuckets[messageBuckets.length - 1]?.date}</span>
        </div>
      </div>

      {/* Handoffs per day chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-medium text-gray-700 mb-4">Handoffs per Day (last 30 days)</h2>
        <div className="flex items-end gap-1 h-24">
          {handoffBuckets.map((bucket) => (
            <div key={bucket.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-red-400 rounded-t"
                style={{ height: `${(bucket.count / maxHoCount) * 100}%`, minHeight: '2px' }}
                title={`${bucket.date}: ${bucket.count}`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{handoffBuckets[0]?.date}</span>
          <span>{handoffBuckets[handoffBuckets.length - 1]?.date}</span>
        </div>
      </div>
    </div>
  );
}
