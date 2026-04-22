package alias

import (
	"line-cli-go/cmd/richmenu"

	"github.com/spf13/cobra"
)

// AliasCmd is the root of the `richmenu alias` subcommand group.
var AliasCmd = &cobra.Command{
	Use:   "alias",
	Short: "Rich Menu alias CRUD",
}

func init() {
	richmenu.RichMenuCmd.AddCommand(AliasCmd)
}
