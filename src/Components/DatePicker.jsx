import React, { useState, useContext, useMemo } from 'react';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker as MuiDatePicker } from '@mui/x-date-pickers/DatePicker';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import dayjs from 'dayjs';
import { ThemeContext } from '../context/ThemeContext';

const DatePicker = ({
  id = "default-datepicker",
  name,
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  label,
}) => {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(null);
  const { isDarkMode } = useContext(ThemeContext);

  const theme = useMemo(() => createTheme({
    palette: {
      mode: isDarkMode ? 'dark' : 'light',
      primary: {
        main: '#2563eb', // brand blue
      },
      background: {
        default: isDarkMode ? '#1e1e1e' : '#ffffff',
        paper: isDarkMode ? '#212121' : '#ffffff',
      },
    },
    components: {
      MuiButtonBase: {
        defaultProps: {
          disableRipple: false,
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backdropFilter: 'blur(12px)',
            backgroundColor: isDarkMode ? 'rgba(33, 33, 33, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            borderRadius: '16px',
            boxShadow: isDarkMode ? '0 8px 32px 0 rgba(0, 0, 0, 0.3)' : '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
            border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(255, 255, 255, 0.5)',
          },
        },
      },
    },
  }), [isDarkMode]);

  // Use props value if controlled, else use internal state for component testing
  const isControlled = value !== undefined;
  const parsedValue = isControlled 
    ? (value ? dayjs(value) : null)
    : internalValue;

  return (
    <div className="flex flex-col gap-1 w-full cursor-pointer">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {label}
        </label>
      )}
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <MuiDatePicker
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            value={parsedValue}
            onChange={(newValue) => {
              if (!isControlled) {
                setInternalValue(newValue);
              }
              if (onChange) {
                 onChange({ target: { name: name || id, id, value: newValue ? newValue.format('YYYY-MM-DD') : '' } });
              }
            }}
            format="DD/MM/YYYY"
            minDate={dayjs('2020-01-01')}
            maxDate={dayjs('2030-12-31')}
            closeOnSelect={true}
            slotProps={{
              actionBar: { actions: ['today'] },
              popper: {
                sx: {
                  '& .MuiPaper-root': {
                    backdropFilter: 'blur(12px)',
                    backgroundColor: isDarkMode ? 'rgba(33, 33, 33, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                    borderRadius: '16px',
                    boxShadow: isDarkMode ? '0 8px 32px 0 rgba(0, 0, 0, 0.3)' : '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
                    border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(255, 255, 255, 0.5)',
                  }
                }
              },
              textField: {
              size: 'small',
              placeholder: placeholder,
              id: id,
              name: name || id,
              fullWidth: true,
              onClick: () => setOpen(true),
              sx: {
                backgroundColor: isDarkMode ? '#212121' : '#ffffff',
                cursor: 'pointer',
                '& .MuiInputBase-input': {
                   cursor: 'pointer',
                   color: isDarkMode ? '#f1f1f1' : '#1e293b',
                },
                '& .MuiOutlinedInput-root': {
                   borderRadius: '8px',
                   fontSize: '14px',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                   borderColor: isDarkMode ? '#3f3f3f' : '#cbd5e1',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                   borderColor: isDarkMode ? '#555555' : '#94a3b8',
                }
              }
            }
          }}
        />
      </LocalizationProvider>
      </ThemeProvider>
    </div>
  );
};

export default DatePicker;
