import { X } from 'lucide-react';

/**
 * PlatformBar - Centered streaming platform selector
 * Displays provider logos as selectable pills with visual feedback
 */
export default function PlatformBar({
  providers = [],
  selected = [],
  onChange,
  loading = false,
  showClearAll = true
}) {
  const toggleProvider = (id) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const clearAll = () => {
    onChange([]);
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6">
        <div className="flex flex-wrap justify-center gap-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="w-20 h-24 bg-slate-700/50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!providers.length) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 rounded-2xl p-6 border border-slate-700/50">
      {/* Clear button when selections exist */}
      {selected.length > 0 && showClearAll && (
        <div className="flex justify-end mb-3">
          <button
            onClick={clearAll}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-slate-700/50"
          >
            <X className="w-3 h-3" />
            Clear ({selected.length})
          </button>
        </div>
      )}

      {/* Centered provider grid */}
      <div className="flex flex-wrap justify-center gap-3">
        {providers.map((provider) => {
          const isSelected = selected.includes(provider.id);
          return (
            <button
              key={provider.id}
              onClick={() => toggleProvider(provider.id)}
              className={`
                flex flex-col items-center gap-2 p-3 rounded-xl transition-all duration-200 min-w-[80px]
                ${isSelected
                  ? 'bg-gradient-to-br from-blue-500/30 to-purple-500/30 ring-2 ring-blue-400 scale-105 shadow-lg shadow-blue-500/25'
                  : 'bg-slate-700/40 hover:bg-slate-600/50 hover:scale-102'
                }
              `}
              title={provider.name}
            >
              <div className={`
                w-14 h-14 rounded-xl overflow-hidden bg-white flex items-center justify-center shadow-md
                ${isSelected ? 'ring-2 ring-white/40' : ''}
              `}>
                {provider.logo_path ? (
                  <img
                    src={provider.logo_path}
                    alt={provider.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-xs text-center px-1 text-slate-600 font-bold">
                    {provider.name.slice(0, 3).toUpperCase()}
                  </span>
                )}
              </div>
              <span className={`
                text-xs font-medium text-center leading-tight
                ${isSelected ? 'text-white' : 'text-slate-400'}
              `}>
                {provider.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
