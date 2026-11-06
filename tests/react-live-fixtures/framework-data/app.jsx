import React, { forwardRef, memo } from 'react';

// Shaped like a component library: a styled root, a base, and a public
// component, all rendering one <button>, with a hashed class name.
// displayName is set explicitly, as component libraries do: bundlers rename
// the inner function names of `const X = forwardRef(function X() {})`.
const ButtonRoot = forwardRef((props, ref) => <button ref={ref} className="css-1abcd9" {...props} />);
ButtonRoot.displayName = 'ButtonRoot';
const ButtonBase = forwardRef((props, ref) => <ButtonRoot ref={ref} {...props} />);
ButtonBase.displayName = 'ButtonBase';
const FancyButton = memo(forwardRef(({ variant, children }, ref) => (
  <ButtonBase ref={ref} variant={variant}>{children}</ButtonBase>
)));
FancyButton.type.displayName = 'FancyButton';

function Row() {
  return (
    <div style={{ display: 'flex' }}>
      <FancyButton variant="contained">Save</FancyButton>
      <span>plain</span>
    </div>
  );
}

export default function App() {
  return <Row />;
}
