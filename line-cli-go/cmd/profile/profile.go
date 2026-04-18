package profile

import "github.com/spf13/cobra"

var ProfileCmd = &cobra.Command{
	Use:   "profile",
	Short: "Get user profiles",
}

func init() {
	ProfileCmd.AddCommand(getCmd)
}
