package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a rich menu alias by ID",
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
		resp, err := api.GetRichMenuAlias(aliasID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	getCmd.Flags().String("alias-id", "", "alias ID (required)")
	AliasCmd.AddCommand(getCmd)
}
