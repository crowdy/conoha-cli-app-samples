package richmenu

import "github.com/spf13/cobra"

// RichMenuCmd is the root of the `richmenu` subcommand group.
// Sibling files attach their individual verbs via init() -> RichMenuCmd.AddCommand(...).
var RichMenuCmd = &cobra.Command{
	Use:   "richmenu",
	Short: "Rich Menu CRUD, image, default, and user linking",
}
