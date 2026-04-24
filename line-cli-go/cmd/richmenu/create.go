package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a rich menu from a JSON payload",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.CreateRichMenu(&req)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	createCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	_ = createCmd.MarkFlagRequired("payload-file")
	RichMenuCmd.AddCommand(createCmd)
}
