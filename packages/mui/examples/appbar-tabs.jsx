// A real Material UI app bar that holds the tab strip, with the tab panels
// OUTSIDE it (the usual `AppBar > Toolbar + Tabs` layout), fixed to the top:
//   html2lvgl packages/mui/examples/appbar-tabs.jsx --size 320x240
// The core maps the strip to buttons, the panels to boxes, and the open tab to
// an LVGL subject, so a tap switches the panel (src/components/appbar-tabs.mjs).
// All three panels are rendered (hidden) so each tab has content to show.
import * as React from 'react';
import { AppBar, Box, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import FavoriteIcon from '@mui/icons-material/Favorite';
import PersonPinIcon from '@mui/icons-material/PersonPin';

const PANELS = ['Recent calls.', 'Favorite contacts.', 'People nearby.'];

export default function App() {
  const [value, setValue] = React.useState(2);
  return (
    <Box sx={{ width: 320, height: 240, boxSizing: 'border-box', bgcolor: '#fafafa', fontFamily: 'Roboto, Helvetica, Arial, sans-serif', overflow: 'hidden' }}>
      <AppBar position="fixed" color="default">
        <Toolbar variant="dense"><Typography variant="subtitle1">Contacts</Typography></Toolbar>
        <Tabs value={value} onChange={(e, v) => setValue(v)} textColor="primary" indicatorColor="primary" variant="fullWidth" aria-label="contact lists">
          <Tab icon={<PhoneIcon fontSize="small" />} label="Recents" id="contacts-tab-0" aria-controls="contacts-panel-0" />
          <Tab icon={<FavoriteIcon fontSize="small" />} label="Favorites" id="contacts-tab-1" aria-controls="contacts-panel-1" />
          <Tab icon={<PersonPinIcon fontSize="small" />} label="Nearby" id="contacts-tab-2" aria-controls="contacts-panel-2" />
        </Tabs>
      </AppBar>
      <Toolbar variant="dense" />
      <Box sx={{ height: 72 }} />
      {PANELS.map((text, i) => (
        <div key={i} role="tabpanel" hidden={value !== i} id={`contacts-panel-${i}`} aria-labelledby={`contacts-tab-${i}`}>
          <Box sx={{ p: 2 }}><Typography variant="body2">{text}</Typography></Box>
        </div>
      ))}
    </Box>
  );
}
