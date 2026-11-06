// A named component that renders no DOM sits beside the element a library
// component renders, the way emotion's `Insertion` sits beside every Material
// UI root element. The element must still be stamped with the component chain.
function Insertion() {
  return null;
}
function Styled({ children }) {
  return (
    <>
      <Insertion />
      <button className="root">{children}</button>
    </>
  );
}
function Fancy() {
  return <Styled>Go</Styled>;
}
export default function App() {
  return <div><Fancy /></div>;
}
