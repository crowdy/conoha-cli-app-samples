package content

import "github.com/spf13/cobra"

var ContentCmd = &cobra.Command{
	Use:   "content",
	Short: "Retrieve message content (images, videos, files)",
}

func init() {
	ContentCmd.AddCommand(getCmd)
}
