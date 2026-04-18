package message

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var narrowcastCmd = &cobra.Command{
	Use:   "narrowcast",
	Short: "Send a narrowcast message (async, returns request ID)",
	RunE: func(cmd *cobra.Command, args []string) error {
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		_, err = api.Narrowcast(
			&messaging_api.NarrowcastRequest{
				Messages: msgs,
			},
			"",
		)
		if err != nil {
			p.Error(0, err.Error())
			return err
		}

		p.Success("Narrowcast accepted (202)", nil)
		return nil
	},
}

func init() {
	narrowcastCmd.Flags().String("text", "", "text message content")
	narrowcastCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
