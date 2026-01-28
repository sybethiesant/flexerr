import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X, Search } from 'lucide-react';

/**
 * FilterDropdown - Reusable dropdown filter component
 * Supports single and multi-select modes, with optional search
 */
export default function FilterDropdown({
  label,
  icon: Icon,
  options = [],
  selected = [],
  onChange,
  multi = false,
  searchable = false,
  placeholder = 'All',
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options by search
  const filteredOptions = searchable && search
    ? options.filter(opt =>
        opt.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  // Get display text
  const getDisplayText = () => {
    if (!selected.length) return placeholder;
    if (multi) {
      if (selected.length === 1) {
        const opt = options.find(o => o.value === selected[0]);
        return opt?.label || selected[0];
      }
      return `${selected.length} selected`;
    }
    const opt = options.find(o => o.value === selected[0]);
    return opt?.label || selected[0];
  };

  const handleSelect = (value) => {
    if (multi) {
      if (selected.includes(value)) {
        onChange(selected.filter(s => s !== value));
      } else {
        onChange([...selected, value]);
      }
    } else {
      onChange(selected[0] === value ? [] : [value]);
      setIsOpen(false);
    }
  };

  const clearSelection = (e) => {
    e.stopPropagation();
    onChange([]);
  };

  const hasSelection = selected.length > 0;

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200
          ${hasSelection
            ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/50'
            : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
          }
        `}
      >
        {Icon && <Icon className="w-4 h-4" />}
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-sm ${hasSelection ? 'text-blue-300' : 'text-slate-400'}`}>
          {getDisplayText()}
        </span>
        {hasSelection ? (
          <button
            onClick={clearSelection}
            className="ml-1 p-0.5 rounded hover:bg-slate-600 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        ) : (
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 min-w-[200px] max-w-[300px] bg-slate-800 rounded-xl shadow-xl border border-slate-700 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Search input */}
          {searchable && (
            <div className="p-2 border-b border-slate-700">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-700/50 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400 text-center">
                No options found
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={`
                      w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors
                      ${isSelected
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'text-slate-300 hover:bg-slate-700/50'
                      }
                    `}
                  >
                    {multi && (
                      <div className={`
                        w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                        ${isSelected
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-slate-500'
                        }
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    )}
                    {option.icon && <option.icon className="w-4 h-4 flex-shrink-0" />}
                    <span className="text-sm truncate">{option.label}</span>
                    {!multi && isSelected && (
                      <Check className="w-4 h-4 ml-auto text-blue-400 flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Clear all for multi-select */}
          {multi && selected.length > 0 && (
            <div className="p-2 border-t border-slate-700">
              <button
                onClick={() => {
                  onChange([]);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * RangeSlider - For year and rating ranges
 * Uses two overlapping range inputs with pointer-events management
 */
export function RangeSlider({
  label,
  min,
  max,
  value = [min, max],
  onChange,
  step = 1,
  formatValue = (v) => v,
  className = ''
}) {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(null); // 'min', 'max', or null

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const handleMinChange = (e) => {
    const newMin = Math.min(Number(e.target.value), localValue[1] - step);
    setLocalValue([newMin, localValue[1]]);
  };

  const handleMaxChange = (e) => {
    const newMax = Math.max(Number(e.target.value), localValue[0] + step);
    setLocalValue([localValue[0], newMax]);
  };

  const handleMouseUp = () => {
    setIsDragging(null);
    onChange(localValue);
  };

  const isDefault = localValue[0] === min && localValue[1] === max;

  // Calculate thumb positions as percentages
  const minPercent = ((localValue[0] - min) / (max - min)) * 100;
  const maxPercent = ((localValue[1] - min) / (max - min)) * 100;

  return (
    <div className={`bg-slate-700/50 rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-300">{label}</span>
        <span className={`text-sm ${isDefault ? 'text-slate-400' : 'text-blue-400'}`}>
          {formatValue(localValue[0])} - {formatValue(localValue[1])}
        </span>
      </div>
      <div className="relative h-6">
        {/* Background track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-slate-600 rounded-full" />

        {/* Active range */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1 bg-blue-500 rounded-full pointer-events-none"
          style={{
            left: `${minPercent}%`,
            right: `${100 - maxPercent}%`
          }}
        />

        {/* Min slider - z-index higher when dragging or when thumbs are close on left side */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue[0]}
          onChange={handleMinChange}
          onMouseDown={() => setIsDragging('min')}
          onTouchStart={() => setIsDragging('min')}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleMouseUp}
          className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:pointer-events-auto"
          style={{ zIndex: isDragging === 'min' || minPercent > 50 ? 5 : 3 }}
        />

        {/* Max slider - z-index higher when dragging or when thumbs are close on right side */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue[1]}
          onChange={handleMaxChange}
          onMouseDown={() => setIsDragging('max')}
          onTouchStart={() => setIsDragging('max')}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleMouseUp}
          className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:pointer-events-auto"
          style={{ zIndex: isDragging === 'max' || maxPercent <= 50 ? 5 : 3 }}
        />
      </div>
    </div>
  );
}

/**
 * ActiveFilters - Display applied filters as removable chips
 */
export function ActiveFilters({
  filters = {},
  labels = {},
  onRemove,
  onClearAll
}) {
  const chips = [];

  // Build chips from filters
  Object.entries(filters).forEach(([key, values]) => {
    if (Array.isArray(values) && values.length > 0) {
      values.forEach(value => {
        const label = labels[key]?.[value] || value;
        chips.push({ key, value, label: `${key}: ${label}` });
      });
    } else if (values && typeof values === 'object' && (values.min || values.max)) {
      const label = `${key}: ${values.min || '?'} - ${values.max || '?'}`;
      chips.push({ key, value: 'range', label });
    }
  });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-400">Active:</span>
      {chips.map((chip, i) => (
        <button
          key={`${chip.key}-${chip.value}-${i}`}
          onClick={() => onRemove(chip.key, chip.value)}
          className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs hover:bg-blue-500/30 transition-colors"
        >
          <span>{chip.label}</span>
          <X className="w-3 h-3" />
        </button>
      ))}
      <button
        onClick={onClearAll}
        className="text-xs text-slate-400 hover:text-white transition-colors ml-2"
      >
        Clear all
      </button>
    </div>
  );
}
