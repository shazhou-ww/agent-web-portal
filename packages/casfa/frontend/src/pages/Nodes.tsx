import { Box, Typography } from "@mui/material";
import FileExplorer from "../components/FileExplorer";

export default function Nodes() {
  return (
    <Box sx={{ height: "calc(100vh - 140px)" }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          Nodes
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Browse and manage stored content nodes
        </Typography>
      </Box>

      <FileExplorer />
    </Box>
  );
}
