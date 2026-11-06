// The same Material UI components with their class names renamed: a design
// system that calls ClassNameGenerator.configure() (or one that ships hashed
// class names) hides every `Mui*-root` class, so the core's class matching
// finds nothing. React still knows the components, and the plugin matches on
// those names.
//   html2lvgl packages/mui/examples/branded.jsx --plugin @richardmcquiston01/html-to-lvgl-mui --size 320x240
import * as React from 'react';
import { Box, Button, Checkbox, FormControlLabel, Radio, Rating, Typography } from '@mui/material';
import { unstable_ClassNameGenerator as ClassNameGenerator } from '@mui/material/className';

ClassNameGenerator.configure((componentName) => componentName.replace('Mui', 'Acme'));

export default function App() {
  return (
    <Box sx={{ width: 320, height: 240, boxSizing: 'border-box', p: 1.5, bgcolor: '#fff', fontFamily: 'Roboto, Helvetica, Arial, sans-serif', overflow: 'hidden' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>Acme account</Typography>
      <FormControlLabel control={<Checkbox defaultChecked size="small" sx={{ p: 0.75 }} />} label="Keep me signed in" slotProps={{ typography: { variant: 'body2' } }} />
      <FormControlLabel control={<Checkbox size="small" sx={{ p: 0.75 }} />} label="Send me product news" slotProps={{ typography: { variant: 'body2' } }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Radio checked size="small" sx={{ p: 0.75 }} />
        <Typography variant="body2">Monthly</Typography>
        <Radio size="small" sx={{ p: 0.75 }} />
        <Typography variant="body2">Yearly</Typography>
      </Box>
      <Rating value={2} readOnly size="small" sx={{ mt: 1 }} />
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button variant="contained" size="small">Continue</Button>
        <Button variant="outlined" size="small">Back</Button>
      </Box>
    </Box>
  );
}
