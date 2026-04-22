package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "Delete a rich menu alias",
	RunE: func(cmd *cobra.Command, args []string) error {
		aliasID, _ := cmd.Flags().GetString("alias-id")
		if aliasID == "" {
			return &config.ClientError{Msg: "--alias-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.DeleteRichMenuAlias(aliasID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Success("Rich menu alias deleted", map[string]string{"richMenuAliasId": aliasID})
		return nil
	},
}

func init() {
	deleteCmd.Flags().String("alias-id", "", "alias ID (required)")
	_ = deleteCmd.MarkFlagRequired("alias-id")
	AliasCmd.AddCommand(deleteCmd)
}
