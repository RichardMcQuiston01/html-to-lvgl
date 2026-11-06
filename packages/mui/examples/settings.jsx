// A real Material UI settings panel, rendered by React and converted through
// the React plugin plus the Material UI plugin:
//   html2lvgl packages/mui/examples/settings.jsx --plugin @richardmcquiston01/html-to-lvgl-mui --size 320x240
import * as React from 'react';
import {
  Box, Button, Checkbox, FormControlLabel, IconButton, Radio, RadioGroup, Rating, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';

export default function App() {
  return (
    <Box sx={{ width: 320, height: 240, boxSizing: 'border-box', p: 1.5, bgcolor: '#fff', fontFamily: 'Roboto, Helvetica, Arial, sans-serif', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>Notifications</Typography>
        <SettingsIcon fontSize="small" color="action" />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <FormControlLabel control={<Checkbox defaultChecked size="small" sx={{ p: 0.75 }} />} label="Email alerts" slotProps={{ typography: { variant: 'body2' } }} />
        <FormControlLabel control={<Checkbox size="small" sx={{ p: 0.75 }} />} label="Push messages" slotProps={{ typography: { variant: 'body2' } }} />
        <FormControlLabel disabled control={<Checkbox size="small" sx={{ p: 0.75 }} />} label="SMS (unavailable)" slotProps={{ typography: { variant: 'body2' } }} />
      </Box>
      <RadioGroup row defaultValue="daily">
        <FormControlLabel value="daily" control={<Radio size="small" sx={{ p: 0.75 }} />} label="Daily" slotProps={{ typography: { variant: 'body2' } }} />
        <FormControlLabel value="weekly" control={<Radio size="small" sx={{ p: 0.75 }} />} label="Weekly" slotProps={{ typography: { variant: 'body2' } }} />
      </RadioGroup>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Rating value={4} readOnly size="small" />
        <Typography variant="caption" color="text.secondary">4 of 5</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Button variant="contained" size="small">Save</Button>
        <Button variant="outlined" size="small">Cancel</Button>
        <Button variant="text" size="small" disabled>Reset</Button>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton aria-label="add" size="small" color="primary"><AddIcon fontSize="small" /></IconButton>
        <IconButton aria-label="delete" size="small"><DeleteIcon fontSize="small" /></IconButton>
      </Box>
    </Box>
  );
}
