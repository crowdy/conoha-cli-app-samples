package batch

import (
	"line-cli-go/cmd/richmenu"

	"github.com/spf13/cobra"
)

// BatchCmd is the root of the `richmenu batch` subcommand group.
var BatchCmd = &cobra.Command{
	Use:   "batch",
	Short: "Rich Menu batch async operations",
}

func init() {
	richmenu.RichMenuCmd.AddCommand(BatchCmd)
}
