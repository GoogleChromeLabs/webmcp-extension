import React from 'react';

/**
 * TextInput Component (Text)
 * Figma Node ID: 3344:8537
 * Props:
 *  - property1: 'Input' | 'Active' (default: 'Input')
 *  - value: string
 *  - placeholder: string (default: "Ask Nexus anything")
 *  - onChange: function
 *  - onFocus: function
 *  - onBlur: function
 */
export function TextInput({
  property1 = 'Input',
  value = '',
  placeholder = 'Ask Nexus anything',
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onSubmit,
  className = ''
}) {
  const isActive = property1 === 'Active';

  const handleKeyDown = (e) => {
    if (onKeyDown) onKeyDown(e);
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (onSubmit) onSubmit();
    }
  };

  return (
    <div className={`nexus-text-input ${className}`} data-node-id="3344:8537">
      {!isActive && !value && <span className="nexus-text-input__cursor" />}
      <input
        type="text"
        className="nexus-text-input__field"
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        data-node-id={isActive ? "3344:8535" : "3344:8536"}
      />
      {isActive && <span className="nexus-text-input__cursor" />}
    </div>
  );
}

export default TextInput;
